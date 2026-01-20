import { Podcast } from 'podcast';
import { Chapter } from '../models/Chapter.js';
import { performance } from 'perf_hooks';
import { IChapterCache } from '../cache/IChapterCache.js';
import { InMemoryChapterCache } from '../cache/InMemoryChapterCache.js';
import { RedisChapterCache } from '../cache/RedisChapterCache.js';

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
