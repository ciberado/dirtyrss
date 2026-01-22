import { Podcast } from 'podcast';
import { Chapter } from '../models/Chapter.js';
import { performance } from 'perf_hooks';
import { IChapterCache } from '../cache/IChapterCache.js';
import { InMemoryChapterCache } from '../cache/InMemoryChapterCache.js';
import { RedisChapterCache } from '../cache/RedisChapterCache.js';
import { ImageProcessor } from '../utils/ImageProcessor.js';
import * as path from 'path';
import * as fs from 'fs';

export abstract class Channel {
    
    protected static chapterCache: IChapterCache;
    protected static cacheInitialized: boolean = false;

    protected channelName: string;
    protected description?: string;
    protected feedUrl?: string;
    protected siteUrl?: string;
    protected imageUrl?: string;
    protected author?: string;
    protected ttlInMinutes?: number;
    protected link?: string;

    constructor(channelName : string) {
        this.channelName = channelName;
    }

    protected static async initializeCache(): Promise<void> {
        if (Channel.cacheInitialized) {
            return;
        }

        const cacheType = process.env.CACHE_TYPE || 'memory';
        
        if (cacheType === 'redis') {
            console.info('Initializing Redis cache...');
            Channel.chapterCache = await RedisChapterCache.create();
        } else {
            console.info('Initializing in-memory cache...');
            Channel.chapterCache = new InMemoryChapterCache();
        }
        
        Channel.cacheInitialized = true;
    }

    protected abstract fetchChannelInformation() : Promise<void>;
    
    protected abstract fetchEpisodeList() : Promise<Chapter[]>;

    protected abstract fetchChapterData(identifier: string): Promise<Chapter>;
    
    /**
     * Retorna la ruta del logo si existe, undefined si no
     */
    protected getLogoPath(): string | undefined {
        return undefined;
    }
    
    /**
     * Retorna el color de fondo del badge
     */
    protected getBadgeColor(): string | undefined {
        return undefined;
    }
    
    /**
     * Aplica watermark al imageUrl si existe logo configurado
     */
    protected async applyChannelWatermark(staticFilesPath: string, chapterUrlPrefix: string): Promise<void> {
        const logoPath = this.getLogoPath();
        const backgroundColor = this.getBadgeColor();
        
        if (!logoPath || !backgroundColor) {
            return;
        }
        
        const fullLogoPath = `${path.resolve('.')}/${logoPath}`;
        if (!fs.existsSync(fullLogoPath)) {
            console.warn(`Logo not found at ${fullLogoPath}, skipping watermark`);
            return;
        }
        
        const imageProcessor = new ImageProcessor(staticFilesPath, chapterUrlPrefix);
        this.imageUrl = await imageProcessor.processChannelImage(
            this.imageUrl,
            this.constructor.name.replace('Channel', '').toLowerCase(),
            this.channelName,
            {
                logoPath: fullLogoPath,
                backgroundColor: backgroundColor,
                badgeShape: 'blob',
                badgeSize: 0.155
            },
            24
        );
    }

    public async generateFeed(): Promise<string | undefined> {
        console.info(`Creating rss feed.`);

        await Channel.initializeCache();

        console.debug(`Getting channel information.`);
        await this.fetchChannelInformation();

        console.debug(`Retrieving list of chapters.`);
        const startTime = performance.now();
        const chapters = await this.fetchEpisodeList();
        const endTime = performance.now();
        console.info(`${chapters.length} chapters found for channel ${this.channelName} in ${endTime - startTime} ms.`);

        const feed = new Podcast({
            title: this.channelName,
            author: this.author,
            description: this.description,
            imageUrl: this.imageUrl,
            itunesImage: this.imageUrl,
            ttl: this.ttlInMinutes,
            siteUrl: this.link,
            generator: 'dirtyrss',
            customNamespaces: {
                itunes: 'http://www.itunes.com/dtds/podcast-1.0.dtd',
                podcast: 'https://podcastindex.org/namespace/1.0',
            }
        });

        chapters.forEach(c => {
            feed.addItem({
                title: c.title,
                date: c.date.toUTCString(),
                description: c.description,
                imageUrl: c.image,
                itunesImage : c.image,
                itunesDuration : c.duration,
                enclosure: {
                    url: c.fileUrl,
                    type: c.mimeType,
                    size: c.length
                }
            });
        });

        return feed.buildXml();
    }
}
