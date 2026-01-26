import { Chapter } from '../models/Chapter.js';
import { Channel } from './Channel.js';
import { ChapterCacheKey } from '../cache/IChapterCache.js';
import { ExternalTools } from '../utils/ExternalTools.js';
import { YoutubeAudioDownloader } from '../utils/YoutubeAudioDownloader.js';
import { YtDlpQueue } from '../utils/YtDlpQueue.js';
import { performance } from 'perf_hooks';
import { default as got } from 'got';
import * as cheerio from 'cheerio';

interface YoutubeVideoData {
    id: string;
    title: string;
    description: string;
    upload_date: string;
    duration: number;
    thumbnail: string;
    channel: string;
    channel_id: string;
    playlist_index?: number;
}

export class YoutubeChannel extends Channel {
    private static readonly LOGO_PATH: string = 'assets/youtube-logo.svg';
    private static readonly BADGE_COLOR: string = '#FF0000';
    private static readonly FETCH_TIMEOUT_MS: number = 8000;
    private static readonly FETCH_BATCH_SIZE: number = 5;
    
    // Lock en memoria para evitar fetches concurrentes
    private static activeFetches = new Set<string>();
    
    static ytDlpPath: string;
    
    private channelId: string;
    private channelUrl: string;
    private staticFilesPath: string;
    private chapterUrlPrefix: string;

    constructor(channelId: string, chapterUrlPrefix: string = '', staticFilesPath: string = '/tmp/public') {
        super(channelId);
        this.channelId = channelId;
        // Soportar tanto handles (@nombre) como channel IDs (UC...)
        this.channelUrl = channelId.startsWith('@') 
            ? `https://www.youtube.com/${channelId}`
            : `https://www.youtube.com/channel/${channelId}`;
        this.chapterUrlPrefix = chapterUrlPrefix;
        this.staticFilesPath = staticFilesPath;
    }
    
    protected getLogoPath(): string | undefined {
        return YoutubeChannel.LOGO_PATH;
    }
    
    protected getBadgeColor(): string | undefined {
        return YoutubeChannel.BADGE_COLOR;
    }

    protected async fetchChannelInformation(): Promise<void> {
        console.info(`Configuring feed for ${this.channelUrl}`);
        
        try {
            // Obtener la imagen del canal desde la página web
            const channelImage = await this.getChannelImage();
            
            // Obtener metadata básica del primer video
            const stdout = await YtDlpQueue.exec(
                `${YoutubeChannel.ytDlpPath} --dump-json --playlist-items 1 "${this.channelUrl}/videos"`
            );
            
            const videoData: YoutubeVideoData = JSON.parse(stdout.split('\n')[0]);
            
            this.channelName = videoData.channel;
            this.author = videoData.channel;
            this.description = `Videos from ${videoData.channel}`;
            this.imageUrl = channelImage;
            this.ttlInMinutes = 60;
            this.siteUrl = this.channelUrl;
            this.link = this.channelUrl;
            
            await this.applyChannelWatermark(this.staticFilesPath, this.chapterUrlPrefix);
        } catch (err) {
            console.error(`Error fetching YouTube channel info: ${err}`);
            throw err;
        }
    }
    
    /**
     * Obtiene la imagen del canal desde la página web de YouTube
     */
    private async getChannelImage(): Promise<string> {
        try {
            const response = await got(`${this.channelUrl}/videos`);
            const $ = cheerio.load(response.body);
            
            // Intentar obtener desde meta tag og:image (imagen del canal)
            const ogImage = $('meta[property="og:image"]').attr('content');
            if (ogImage) {
                console.log(`Channel image from og:image: ${ogImage}`);
                return ogImage;
            }
            
            // Fallback: buscar en el JSON de la página
            const match = response.body.match(/"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/);
            if (match && match[1]) {
                console.log(`Channel image from JSON: ${match[1]}`);
                return match[1];
            }
            
            // Fallback final: imagen por defecto de YouTube
            console.warn(`Could not find channel image, using default`);
            return `https://yt3.googleusercontent.com/ytc/${this.channelId}=s900-c-k-c0x00ffffff-no-rj`;
        } catch (error) {
            console.error(`Error getting channel image: ${error}`);
            // Fallback: imagen por defecto
            return `https://yt3.googleusercontent.com/ytc/${this.channelId}=s900-c-k-c0x00ffffff-no-rj`;
        }
    }

    protected async fetchEpisodeList(): Promise<Chapter[]> {
        const startTime = performance.now();
        const lockKey = `youtube:channel:${this.channelId}`;
        
        // Si ya hay un fetch activo, devolver caché
        if (YoutubeChannel.activeFetches.has(lockKey)) {
            console.log(`Fetch already in progress for ${lockKey}, returning cache`);
            
            const firstVideo = await this.getFirstVideo();
            if (firstVideo) {
                const feedCacheKey = ChapterCacheKey.forFeedCache('youtube', this.channelId, firstVideo.id);
                const cachedFeed = await Channel.chapterCache.getChapterList(feedCacheKey);
                if (cachedFeed && cachedFeed.chapters.length > 0) {
                    console.log(`Returning ${cachedFeed.chapters.length} cached chapters while fetch in progress`);
                    return cachedFeed.chapters;
                }
            }
            
            console.log(`No cache available, returning empty array`);
            return [];
        }
        
        // Adquirir lock
        YoutubeChannel.activeFetches.add(lockKey);
        
        try {
            console.log(`Retrieving videos for channel ${this.channelId}`);
            
            // Obtener el primer video para la cache key
            const firstVideo = await this.getFirstVideo();
            
            if (firstVideo) {
                const feedCacheKey = ChapterCacheKey.forFeedCache('youtube', this.channelId, firstVideo.id);
                
                console.log(`Channel URL: ${this.channelUrl}`);
                console.log(`First video - id: ${firstVideo.id}, title: ${firstVideo.title}`);
                console.log(`Feed cache key: ${feedCacheKey}`);
                
                const cachedFeed = await Channel.chapterCache.getChapterList(feedCacheKey);
                
                console.log(`Cache result: ${cachedFeed ? `found ${cachedFeed.chapters.length} chapters (${cachedFeed.isComplete ? 'complete' : 'partial'})` : 'NOT FOUND'}`);
                
                if (cachedFeed && cachedFeed.isComplete) {
                    const endTime = performance.now();
                    console.log(`Feed cache hit! First video unchanged (${firstVideo.title}). Returning ${cachedFeed.chapters.length} cached chapters in ${(endTime - startTime).toFixed(2)}ms`);
                    return cachedFeed.chapters;
                } else {
                    console.log(`Feed cache miss. First video: "${firstVideo.title}". Fetching all videos...`);
                }
            }
            
            // Obtener lista de IDs usando la cola
            const stdout = await YtDlpQueue.exec(
                `${YoutubeChannel.ytDlpPath} --flat-playlist --print "%(id)s" "${this.channelUrl}/videos"`
            );
            
            const videoIds = stdout.split('\n').filter(line => line.trim());
            console.log(`Found ${videoIds.length} videos in channel, fetching metadata...`);
            
            let collectedChapters: Chapter[] = [];
            let timeoutReached = false;
            let hasBackgroundLoading = false;
            
            const timeoutPromise = new Promise<Chapter[]>((_, reject) => {
                setTimeout(() => {
                    timeoutReached = true;
                    reject(new Error('Timeout reached'));
                }, YoutubeChannel.FETCH_TIMEOUT_MS);
            });
            
            try {
                // Procesar en batches preservando el orden original
                for (let i = 0; i < videoIds.length && !timeoutReached; i += YoutubeChannel.FETCH_BATCH_SIZE) {
                    const batch = videoIds.slice(i, i + YoutubeChannel.FETCH_BATCH_SIZE);
                    
                    try {
                        const batchResults = await Promise.race([
                            Promise.allSettled(batch.map(id => this.fetchChapterData(id))),
                            timeoutPromise
                        ]) as PromiseSettledResult<Chapter>[];
                        
                        // Filtrar solo los exitosos y logear los fallidos
                        for (const result of batchResults) {
                            if (result.status === 'fulfilled') {
                                collectedChapters.push(result.value);
                            } else {
                                console.error(`Error fetching video: ${result.reason}`);
                            }
                        }
                    } catch (error) {
                        if (timeoutReached && collectedChapters.length < videoIds.length) {
                            const remainingIds = videoIds.slice(i + batch.length);
                            if (remainingIds.length > 0) {
                                hasBackgroundLoading = true;
                                this.continueLoadingInBackground(remainingIds, firstVideo);
                            }
                            break;
                        }
                        throw error;
                    }
                }
            } catch (error) {
                if (!timeoutReached) {
                    throw error;
                }
            }
            
            // Ordenar por playlist_index (orden original de YouTube)
            collectedChapters.sort((a, b) => {
                // Si ambos tienen playlist_index, ordenar por eso
                if (a.playlistIndex !== undefined && b.playlistIndex !== undefined) {
                    return a.playlistIndex - b.playlistIndex;
                }
                // Si solo uno tiene index, el que tiene va primero
                if (a.playlistIndex !== undefined) return -1;
                if (b.playlistIndex !== undefined) return 1;
                // Si ninguno tiene index, ordenar por fecha (más reciente primero)
                return b.date.getTime() - a.date.getTime();
            });
            
            // Guardar en caché solo si cargamos todo
            if (!hasBackgroundLoading && firstVideo && collectedChapters.length > 0) {
                const feedCacheKey = ChapterCacheKey.forFeedCache('youtube', this.channelId, firstVideo.id);
                await Channel.chapterCache.setChapterList(feedCacheKey, {
                    chapters: collectedChapters,
                    isComplete: true,
                    lastUpdate: Date.now()
                });
                console.log(`Feed cached with ${collectedChapters.length} chapters (complete list). First video: "${firstVideo.title}"`);
            } else if (hasBackgroundLoading) {
                console.log(`Feed NOT cached (background loading in progress)`);
            }
            
            const endTime = performance.now();
            console.log(`fetchEpisodeList completed in ${(endTime - startTime).toFixed(2)}ms`);
            
            return collectedChapters;
            
        } finally {
            // SIEMPRE liberar el lock
            YoutubeChannel.activeFetches.delete(lockKey);
        }
    }
    
    private async getFirstVideo(): Promise<{ id: string, title: string } | undefined> {
        try {
            const stdout = await YtDlpQueue.exec(
                `${YoutubeChannel.ytDlpPath} --dump-json --playlist-items 1 "${this.channelUrl}/videos"`
            );
            
            const video: YoutubeVideoData = JSON.parse(stdout.split('\n')[0]);
            return {
                id: video.id,
                title: video.title
            };
        } catch (error) {
            console.error('Error getting first video:', error);
            return undefined;
        }
    }
    
    private async continueLoadingInBackground(videoIds: string[], firstVideo?: { id: string, title: string }): Promise<void> {
        const startTime = performance.now();
        console.log(`Continuing video fetch in background for ${videoIds.length} videos`);
        
        try {
            const results = await Promise.allSettled(
                videoIds.map(id => this.fetchChapterData(id))
            );
            
            // Filtrar solo los exitosos
            const chapters = results
                .filter((result): result is PromiseFulfilledResult<Chapter> => result.status === 'fulfilled')
                .map(result => result.value);
            
            // Logear errores
            const errors = results.filter(result => result.status === 'rejected');
            if (errors.length > 0) {
                console.error(`${errors.length} videos failed during background fetch`);
            }
            
            const endTime = performance.now();
            console.log(`Background fetch completed. Total chapters: ${chapters.length}`);
            console.log(`Background fetch completed in ${(endTime - startTime).toFixed(2)}ms`);
            
            // Ordenar por playlist_index (orden original de YouTube)
            chapters.sort((a, b) => {
                if (a.playlistIndex !== undefined && b.playlistIndex !== undefined) {
                    return a.playlistIndex - b.playlistIndex;
                }
                if (a.playlistIndex !== undefined) return -1;
                if (b.playlistIndex !== undefined) return 1;
                return b.date.getTime() - a.date.getTime();
            });
            
            // Cachear la lista completa
            if (firstVideo && chapters.length > 0) {
                const feedCacheKey = ChapterCacheKey.forFeedCache('youtube', this.channelId, firstVideo.id);
                await Channel.chapterCache.setChapterList(feedCacheKey, {
                    chapters: chapters,
                    isComplete: true,
                    lastUpdate: Date.now()
                });
                console.log(`Feed cached with complete list (${chapters.length} chapters) after background loading. First video: "${firstVideo.title}"`);
            }
        } catch (error) {
            console.error('Error during background fetch:', error);
        }
    }

    protected async fetchChapterData(id: string): Promise<Chapter> {
        const cacheKey = ChapterCacheKey.forChapter('youtube', this.channelId, id);
        
        const cachedChapter = await Channel.chapterCache.get(cacheKey);
        if (cachedChapter) {
            return cachedChapter;
        }
        
        try {
            const stdout = await YtDlpQueue.exec(
                `${YoutubeChannel.ytDlpPath} --dump-json "https://www.youtube.com/watch?v=${id}"`
            );
            
            const video: YoutubeVideoData = JSON.parse(stdout);
            
            // Obtener el tamaño del archivo de audio (0 si no existe aún)
            const audioDir = `${this.staticFilesPath}/youtube-audio`;
            const audioSize = await YoutubeAudioDownloader.getAudioSize(video.id, audioDir);
            
            // Agregar link del video al final de la descripción
            const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
            const descriptionWithLink = video.description 
                ? `${video.description}\n\n${videoUrl}`
                : videoUrl;
            
            const chapter = new Chapter(
                video.id,
                video.title,
                `${this.chapterUrlPrefix}/youtube/channel/${this.channelId}/${video.id}.m4a`,
                descriptionWithLink,
                this.parseDate(video.upload_date),
                video.thumbnail,
                this.formatDuration(video.duration),
                'audio/mp4',
                audioSize,
                video.playlist_index
            );
            
            Channel.chapterCache.set(cacheKey, chapter);
            return chapter;
        } catch (err) {
            console.error(`Error fetching YouTube video ${id}: ${err}`);
            throw err;
        }
    }
    
    private parseDate(dateStr: string): Date {
        // yt-dlp returns dates as YYYYMMDD
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1;
        const day = parseInt(dateStr.substring(6, 8));
        return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    }
    
    private formatDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

// Descargar yt-dlp al arrancar
try {
    YoutubeChannel.ytDlpPath = await ExternalTools.getYtDlpPath();
} catch (err) {
    console.error(err);
}
