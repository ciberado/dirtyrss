import fs from 'fs';
import { pathExists } from '../utils/FsUtils.js';
import path from 'path';

import * as cheerio from "cheerio"; 
import { default as got } from 'got';

import { Chapter } from '../models/Chapter.js';
import { Channel } from './Channel.js';
import { ChapterCacheKey } from '../cache/IChapterCache.js';
import { ExternalTools } from '../utils/ExternalTools.js';
import { YtDlpQueue } from '../utils/YtDlpQueue.js';

interface TwitchVideoData {
    id: string;
    title: string;
    publishedAt : string;
    lengthSeconds: number;
    creator : {
        login : string,
        displayName : string
    }
}

interface TwitchChannelData {
    count : number;
    totalCount : number,
    videos : TwitchVideoData[];
}

export class TwitchChannel extends Channel{

    private static readonly LOGO_PATH: string = 'assets/twitch-logo.svg';
    private static readonly BADGE_COLOR: string = '#9146FF';
    private static readonly TWITCH_REQUEST_OPTIONS = {
        headers: {
            'user-agent': "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
        }
    }

    static twitchDlPath : string;
    static downloadingEpisodes : { [key: string]: boolean; } = {};
    // Cache de videos por instancia, se limpia al destruirse la instancia
    private allVideosData: TwitchVideoData[] | null = null;
    
    chapterUrlPrefix: string;
    username: string;
    staticFilesPath: string;

    constructor(channelName: string, chapterUrlPrefix : string, staticFilesPath: string = '/tmp/public') {
        super(channelName);
        this.chapterUrlPrefix = chapterUrlPrefix;
        this.username = channelName;
        this.staticFilesPath = staticFilesPath;
    }
    
    protected getLogoPath(): string | undefined {
        return TwitchChannel.LOGO_PATH;
    }
    
    protected getBadgeColor(): string | undefined {
        return TwitchChannel.BADGE_COLOR;
    }

    protected getFeedCacheKey(): string {
        return `twitch:${this.username}:${this.chapterUrlPrefix}`;
    }

    private async fetchChannelMetadata(url: string, maxAttempts: number = 3, delayMs: number = 2000): Promise<{ imageUrl?: string, description?: string }> {
        let imageUrl: string | undefined;
        let description: string | undefined;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (attempt > 1) {
                console.log(`[RETRY] Attempt ${attempt}/${maxAttempts} - waiting ${delayMs}ms for dynamic content...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
            const response = await got(url, TwitchChannel.TWITCH_REQUEST_OPTIONS);
            const body = response.body;
            
            // Scope limitado para Cheerio DOM
            {
                const $ = cheerio.load(body);
                imageUrl = $('meta[property="og:image"]').attr('content')?.trim();
                description = $('meta[property="og:description"]').attr('content')?.trim();
                // DOM se libera aquí
            }
            
            console.log(`[DEBUG] Attempt ${attempt} - og:image: ${imageUrl}`);
            
            // Si contiene "profile" es la imagen correcta
            if (imageUrl && imageUrl.includes('profile')) {
                console.log(`[SUCCESS] Got correct profile image on attempt ${attempt}`);
                break;
            }
            
            // Si es el último intento, usar lo que tengamos
            if (attempt === maxAttempts) {
                console.warn(`[WARNING] Could not get profile image after ${maxAttempts} attempts, using: ${imageUrl}`);
            }
        }
        
        return { imageUrl, description };
    }

    protected async fetchChannelInformation(): Promise<void> {
        const programUrl = `https://twitch.tv/${this.channelName}`;
        console.info(`Configuring feed for ${programUrl}`);
        
        const { imageUrl, description } = await this.fetchChannelMetadata(programUrl);

        this.username = this.channelName.toString();
        this.author = this.channelName.toString();
        this.description = description;
        this.imageUrl = imageUrl;
        this.ttlInMinutes = 60;
        this.siteUrl = programUrl;
        this.link = programUrl;
        
        // Aplicar watermark
        await this.applyChannelWatermark(this.staticFilesPath, this.chapterUrlPrefix);
    }

    private async fetchAllVideosData(): Promise<TwitchVideoData[]> {
        if (this.allVideosData !== null) {
            return this.allVideosData;
        }

        console.log(`Retrieving list of episodes for channel ${this.channelName}.`);

        const command = `/usr/bin/python3 "${TwitchChannel.twitchDlPath}" videos "${this.username}" --json --all`;
        const stdout = await YtDlpQueue.exec(command, `twitch-videos:${this.username}`, 'light', 'twitch-dl', `videos:${this.username}`);

        console.log('List of episodes retrieved.');
        const data = JSON.parse(stdout) as TwitchChannelData;
        const videos = data?.videos ?? [];
        this.allVideosData = videos;
        return videos;
    }

    protected async fetchChapterData(id: string): Promise<Chapter> {
        const cacheKey = ChapterCacheKey.forChapter('twitch', this.username, id);
        
        const cachedChapter = await Channel.chapterCache.get(cacheKey);
        if (cachedChapter) {
            return cachedChapter;
        }

        const videos = await this.fetchAllVideosData();
        const tc = videos.find(v => v.id === id);
        
        if (!tc) {
            throw new Error(`Video ${id} not found for channel ${this.channelName}`);
        }

        let duration = '';
        if (tc.lengthSeconds) {
            const hours = Math.floor(tc.lengthSeconds / 3600);
            const minutes = Math.floor((tc.lengthSeconds % 3600) / 60);
            const seconds = tc.lengthSeconds % 60;
            duration = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        
        let fileSize = 5 * 60 * 1024 * 1024;
        const filePath = `${this.staticFilesPath}/twitch/chapters/${this.username}/${tc.id}.m4a`;
        try {
            fileSize = (await fs.promises.stat(filePath)).size;
        } catch (err) {
            // No existe o no se puede leer: usar tamaño por defecto
        }
        
        const chapter = new Chapter(
            tc.id, 
            tc.title, 
            `${this.chapterUrlPrefix}/twitch/chapters/${this.username}/${tc.id}.m4a`, 
            tc.title, 
            new Date(tc.publishedAt), 
            '', 
            duration, 
            'audio/mp4', 
            fileSize
        );

        Channel.chapterCache.set(cacheKey, chapter);
        
        return chapter;
    }

    protected async fetchEpisodeList() : Promise<Chapter[]> {
        const videos = await this.fetchAllVideosData();
        
        const chapters = await Promise.all(
            videos.map(tc => this.fetchChapterData(tc.id))
        );
        
        return chapters;
    }

    // Método aparte para que TS no estreche el tipo entre los awaits
    private static isDownloading(episodeId: string): boolean {
        return TwitchChannel.downloadingEpisodes[episodeId] === true;
    }

    private async downloadEpisode(episodeId : string, fileName: string) {
        if (TwitchChannel.downloadingEpisodes[episodeId] === true) {
            console.log(`Episode ${episodeId} already being downloaded.`);
            return;
        }

        const tempM4aFile = fileName.replace('.m4a', '.tmp.m4a');
        if (await pathExists(tempM4aFile)) {
            console.log(`Episode ${episodeId} is already being downloaded (${tempM4aFile} exists).`);
            return;
        }

        // Re-comprobar tras el await: otra petición pudo empezar la descarga mientras tanto
        if (TwitchChannel.isDownloading(episodeId)) {
            return;
        }

        await fs.promises.mkdir(path.dirname(fileName), { recursive: true });

        const command = `/usr/bin/python3 "${TwitchChannel.twitchDlPath}" download "${episodeId}" --output "${tempM4aFile}" --overwrite --quality audio_only`;

        console.log(`Downloading episode ${episodeId} in the background`);
        TwitchChannel.downloadingEpisodes[episodeId] = true;

        try {
            await YtDlpQueue.exec(command, `twitch-download:${episodeId}`, 'heavy', 'twitch-dl', `episode:${episodeId}`, tempM4aFile);

            // Move temp M4A to final name (atomic operation)
            await fs.promises.rename(tempM4aFile, fileName);
            console.log(`Episode saved at ${fileName}.`);
        } catch (err) {
            console.error(`[ERROR] Downloading twitch show ${episodeId} (${err}).`);
            await fs.promises.rm(tempM4aFile, { force: true });
        } finally {
            delete TwitchChannel.downloadingEpisodes[episodeId];
        }
    }

    public async getFileNameForEpisode(directoryRoot: string, episodeId: string) : Promise<string | undefined> {
        const fileName = `${directoryRoot}/twitch/chapters/${this.username}/${episodeId}.m4a`;
        console.log(`Ensuring ${fileName} is available.`);

        // check if the file exists, or return the default one
        if (!(await pathExists(fileName))) {
            console.log(`Episode ${episodeId} not available locally.`);
            this.downloadEpisode(episodeId, fileName);
            return;
        } else {
            console.log(`Episode ${episodeId} available.`);
            return fileName;
        }
    }
}

try {
    TwitchChannel.twitchDlPath = await ExternalTools.getTwitchDlPath();
} catch (err) {
    console.error(err);
}
//# sourceMappingURL=TwitchChannel.js.map