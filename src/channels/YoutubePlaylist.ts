import * as cheerio from 'cheerio';
import { default as got } from 'got';
import { Chapter } from '../models/Chapter.js';
import { Channel } from './Channel.js';
import { ChapterCacheKey } from '../cache/IChapterCache.js';
import { YoutubeChannel } from './YoutubeChannel.js';
import { YoutubeAudioDownloader } from '../utils/YoutubeAudioDownloader.js';
import { YtDlpQueue } from '../utils/YtDlpQueue.js';
import { performance } from 'perf_hooks';

interface YoutubeVideoData {
    id: string;
    title: string;
    description: string;
    upload_date: string;
    duration: number;
    thumbnail: string;
    channel: string;
    playlist_title?: string;
    playlist_index?: number;
}

export class YoutubePlaylist extends Channel {
    private static readonly LOGO_PATH: string = 'assets/youtube-logo.svg';
    private static readonly BADGE_COLOR: string = '#FF0000';
    private static readonly FETCH_TIMEOUT_MS: number = 8000;
    private static readonly FETCH_BATCH_SIZE: number = 5;
    
    // Lock en memoria para evitar fetches concurrentes
    private static activeFetches = new Set<string>();
    
    private playlistId: string;
    private playlistUrl: string;
    private staticFilesPath: string;
    private chapterUrlPrefix: string;

    constructor(playlistId: string, chapterUrlPrefix: string = '', staticFilesPath: string = '/tmp/public') {
        super(playlistId);
        this.playlistId = playlistId;
        this.playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
        this.chapterUrlPrefix = chapterUrlPrefix;
        this.staticFilesPath = staticFilesPath;
    }
    
    protected getLogoPath(): string | undefined {
        return YoutubePlaylist.LOGO_PATH;
    }
    
    protected getBadgeColor(): string | undefined {
        return YoutubePlaylist.BADGE_COLOR;
    }

    protected async fetchChannelInformation(): Promise<void> {
        console.info(`Configuring feed for ${this.playlistUrl}`);
        
        try {
            const response = await got(this.playlistUrl);
            const $ = cheerio.load(response.body);
            
            // Extraer metadata de los tags HTML
            const playlistTitle = $('meta[property="og:title"]').attr('content')?.trim() || 
                                 $('meta[name="title"]').attr('content')?.trim() ||
                                 `Playlist ${this.playlistId}`;
            
            const playlistImage = $('meta[property="og:image"]').attr('content')?.trim() ||
                                 `https://i.ytimg.com/vi/${this.playlistId}/hqdefault.jpg`;
            
            // Intentar extraer del JSON ytInitialData para obtener la descripción completa
            let playlistDescription = `Videos from playlist: ${playlistTitle}`;
            let author = 'Unknown';
            let videoCount: number | undefined = undefined;
            
            const ytInitialDataMatch = response.body.match(/var ytInitialData = (\{.*?\});/s);
            if (ytInitialDataMatch) {
                try {
                    const ytData = JSON.parse(ytInitialDataMatch[1]);
                    const sidebar = ytData?.sidebar?.playlistSidebarRenderer?.items;
                    
                    if (sidebar && sidebar.length > 0) {
                        // Primer item tiene info de la playlist
                        const primaryInfo = sidebar[0]?.playlistSidebarPrimaryInfoRenderer;
                        if (primaryInfo) {
                            // Descripción completa
                            const descRuns = primaryInfo?.description?.simpleText;
                            if (descRuns) {
                                playlistDescription = descRuns;
                            }
                            
                            // Número de videos
                            const stats = primaryInfo?.stats;
                            if (stats && stats.length > 0) {
                                const videoCountText = stats[0]?.runs?.[0]?.text || stats[0]?.simpleText;
                                if (videoCountText) {
                                    const match = videoCountText.match(/\d+/);
                                    if (match) {
                                        videoCount = parseInt(match[0]);
                                    }
                                }
                            }
                        }
                        
                        // Segundo item tiene info del owner
                        const secondaryInfo = sidebar[1]?.playlistSidebarSecondaryInfoRenderer;
                        if (secondaryInfo) {
                            const ownerText = secondaryInfo?.videoOwner?.videoOwnerRenderer?.title?.runs?.[0]?.text;
                            if (ownerText) {
                                author = ownerText;
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error parsing ytInitialData:', e);
                    // Fallback a regex
                    const authorMatch = response.body.match(/"ownerText":\{"runs":\[\{"text":"([^"]+)"/);
                    author = authorMatch ? authorMatch[1] : 'Unknown';
                    
                    const statsMatch = response.body.match(/"stats":\[\{"runs":\[\{"text":"(\d+)"\}/);
                    videoCount = statsMatch ? parseInt(statsMatch[1]) : undefined;
                }
            } else {
                // Fallback a meta tag si no hay ytInitialData
                playlistDescription = $('meta[property="og:description"]').attr('content')?.trim() || 
                                     $('meta[name="description"]').attr('content')?.trim() ||
                                     playlistDescription;
            }
            
            this.channelName = playlistTitle;
            this.author = author;
            this.description = playlistDescription;
            this.imageUrl = playlistImage;
            this.ttlInMinutes = 60;
            this.siteUrl = this.playlistUrl;
            this.link = this.playlistUrl;
            
            if (videoCount) {
                console.log(`Playlist has ${videoCount} videos`);
            }
            
            await this.applyChannelWatermark(this.staticFilesPath, this.chapterUrlPrefix);
        } catch (err) {
            console.error(`Error fetching YouTube playlist info: ${err}`);
            throw err;
        }
    }

    protected async fetchEpisodeList(): Promise<Chapter[]> {
        const startTime = performance.now();
        const lockKey = `youtube:playlist:${this.playlistId}`;
        
        // Si ya hay un fetch activo, devolver caché
        if (YoutubePlaylist.activeFetches.has(lockKey)) {
            console.log(`Fetch already in progress for ${lockKey}, returning cache`);
            
            const firstVideo = await this.getFirstVideo();
            if (firstVideo) {
                const feedCacheKey = ChapterCacheKey.forFeedCache('youtube-playlist', this.playlistId, firstVideo.id);
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
        YoutubePlaylist.activeFetches.add(lockKey);
        
        try {
            console.log(`Retrieving videos for playlist ${this.playlistId}`);
            
            // Obtener el primer video para la cache key
            const firstVideo = await this.getFirstVideo();
            
            if (firstVideo) {
                const feedCacheKey = ChapterCacheKey.forFeedCache('youtube-playlist', this.playlistId, firstVideo.id);
                
                console.log(`Playlist URL: ${this.playlistUrl}`);
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
                `${YoutubeChannel.ytDlpPath} --flat-playlist --print "%(id)s" "${this.playlistUrl}"`
            );
            
            const videoIds = stdout.split('\n').filter(line => line.trim());
            console.log(`Found ${videoIds.length} videos in playlist, fetching metadata...`);
            
            let collectedChapters: Chapter[] = [];
            let timeoutReached = false;
            let hasBackgroundLoading = false;
            
            const timeoutPromise = new Promise<Chapter[]>((_, reject) => {
                setTimeout(() => {
                    timeoutReached = true;
                    reject(new Error('Timeout reached'));
                }, YoutubePlaylist.FETCH_TIMEOUT_MS);
            });
            
            try {
                // Procesar en batches como iVoox
                for (let i = 0; i < videoIds.length && !timeoutReached; i += YoutubePlaylist.FETCH_BATCH_SIZE) {
                    const batch = videoIds.slice(i, i + YoutubePlaylist.FETCH_BATCH_SIZE);
                    
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
                if (a.playlistIndex !== undefined && b.playlistIndex !== undefined) {
                    return a.playlistIndex - b.playlistIndex;
                }
                if (a.playlistIndex !== undefined) return -1;
                if (b.playlistIndex !== undefined) return 1;
                return b.date.getTime() - a.date.getTime();
            });
            
            // Guardar en caché solo si cargamos todo
            if (!hasBackgroundLoading && firstVideo && collectedChapters.length > 0) {
                const feedCacheKey = ChapterCacheKey.forFeedCache('youtube-playlist', this.playlistId, firstVideo.id);
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
            YoutubePlaylist.activeFetches.delete(lockKey);
        }
    }
    
    private async getFirstVideo(): Promise<{ id: string, title: string } | undefined> {
        try {
            const stdout = await YtDlpQueue.exec(
                `${YoutubeChannel.ytDlpPath} --dump-json --playlist-items 1 "${this.playlistUrl}"`
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
                const feedCacheKey = ChapterCacheKey.forFeedCache('youtube-playlist', this.playlistId, firstVideo.id);
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
        const cacheKey = ChapterCacheKey.forChapter('youtube-playlist', this.playlistId, id);
        
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
                `${this.chapterUrlPrefix}/youtube/playlist/${this.playlistId}/${video.id}.m4a`,
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
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6)) - 1;
        const day = parseInt(dateStr.substring(6, 8));
        return new Date(year, month, day);
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
