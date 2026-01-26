import { Chapter } from '../models/Chapter.js';
import { IChapterCache, CachedFeed } from './IChapterCache.js';
import { createClient } from 'redis';

type RedisClientType = ReturnType<typeof createClient>;

interface ChapterData {
    id: string;
    title: string;
    fileUrl: string;
    description: string;
    dateTimestamp: number;
    image: string;
    duration: string;
    mimeType: string;
    length: number;
    playlistIndex?: number;
}

export class RedisChapterCache implements IChapterCache {
    private client: RedisClientType;
    private prefix: string;
    private ttl: number; // Time to live en segundos

    constructor(client: RedisClientType, prefix: string = 'chapter:', ttl: number = 86400) {
        this.client = client;
        this.prefix = prefix;
        this.ttl = ttl;
    }

    static async create(prefix: string = 'chapter:', ttl: number = 86400): Promise<RedisChapterCache> {
        const [host, port] = (process.env.REDIS_ADDRESS || 'localhost:6379').split(':');
        
        const client = createClient({
            socket: {
                host: host,
                port: parseInt(port)
            }
        });

        await client.connect();
        
        return new RedisChapterCache(client, prefix, ttl);
    }

    async get(key: string): Promise<Chapter | undefined> {
        const data = await this.client.get(this.prefix + key);
        if (!data) {
            return undefined;
        }

        const parsed: ChapterData = JSON.parse(data);
        return new Chapter(
            parsed.id,
            parsed.title,
            parsed.fileUrl,
            parsed.description,
            new Date(parsed.dateTimestamp),
            parsed.image,
            parsed.duration,
            parsed.mimeType,
            parsed.length,
            parsed.playlistIndex
        );
    }

    async set(key: string, chapter: Chapter): Promise<void> {
        const data: ChapterData = {
            id: chapter.id,
            title: chapter.title,
            fileUrl: chapter.fileUrl,
            description: chapter.description,
            dateTimestamp: chapter.date.getTime(),
            image: chapter.image,
            duration: chapter.duration,
            mimeType: chapter.mimeType,
            length: chapter.length,
            playlistIndex: chapter.playlistIndex
        };
        
        await this.client.setEx(
            this.prefix + key,
            this.ttl,
            JSON.stringify(data)
        );
    }

    async has(key: string): Promise<boolean> {
        const exists = await this.client.exists(this.prefix + key);
        return exists === 1;
    }

    async clear(): Promise<void> {
        const keys = await this.client.keys(this.prefix + '*');
        if (keys.length > 0) {
            await this.client.del(keys);
        }
    }

    async disconnect(): Promise<void> {
        await this.client.quit();
    }

    async getChapterList(key: string): Promise<CachedFeed | undefined> {
        const data = await this.client.get(this.prefix + 'list:' + key);
        if (!data) {
            return undefined;
        }

        const parsed = JSON.parse(data);
        
        // Migración automática: Si es formato antiguo (array), convertir a nuevo formato
        if (Array.isArray(parsed)) {
            const chapters = parsed.map((item: ChapterData) => new Chapter(
                item.id,
                item.title,
                item.fileUrl,
                item.description,
                new Date(item.dateTimestamp),
                item.image,
                item.duration,
                item.mimeType,
                item.length,
                item.playlistIndex
            ));
            
            return {
                chapters,
                isComplete: true, // Asumimos que cachés antiguas estaban completas
                lastUpdate: Date.now()
            };
        }
        
        // Formato nuevo, deserializar chapters
        const chapters = parsed.chapters.map((item: ChapterData) => new Chapter(
            item.id,
            item.title,
            item.fileUrl,
            item.description,
            new Date(item.dateTimestamp),
            item.image,
            item.duration,
            item.mimeType,
            item.length,
            item.playlistIndex
        ));
        
        return {
            chapters,
            isComplete: parsed.isComplete,
            lastUpdate: parsed.lastUpdate
        };
    }

    async setChapterList(key: string, feed: CachedFeed): Promise<void> {
        const dataList: ChapterData[] = feed.chapters.map(chapter => ({
            id: chapter.id,
            title: chapter.title,
            fileUrl: chapter.fileUrl,
            description: chapter.description,
            dateTimestamp: chapter.date.getTime(),
            image: chapter.image,
            duration: chapter.duration,
            mimeType: chapter.mimeType,
            length: chapter.length,
            playlistIndex: chapter.playlistIndex
        }));
        
        const cachedFeed = {
            chapters: dataList,
            isComplete: feed.isComplete,
            lastUpdate: feed.lastUpdate
        };
        
        await this.client.setEx(
            this.prefix + 'list:' + key,
            this.ttl,
            JSON.stringify(cachedFeed)
        );
    }
}
