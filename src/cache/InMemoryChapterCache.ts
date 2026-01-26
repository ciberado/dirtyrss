import { Chapter } from '../models/Chapter.js';
import { IChapterCache, CachedFeed } from './IChapterCache.js';

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
}

export class InMemoryChapterCache implements IChapterCache {
    private cache: Map<string, ChapterData>;
    private listCache: Map<string, CachedFeed>;

    constructor() {
        this.cache = new Map();
        this.listCache = new Map();
    }

    get(key: string): Chapter | undefined {
        const data = this.cache.get(key);
        if (!data) {
            return undefined;
        }

        return new Chapter(
            data.id,
            data.title,
            data.fileUrl,
            data.description,
            new Date(data.dateTimestamp),
            data.image,
            data.duration,
            data.mimeType,
            data.length
        );
    }

    set(key: string, chapter: Chapter): void {
        const data: ChapterData = {
            id: chapter.id,
            title: chapter.title,
            fileUrl: chapter.fileUrl,
            description: chapter.description,
            dateTimestamp: chapter.date.getTime(),
            image: chapter.image,
            duration: chapter.duration,
            mimeType: chapter.mimeType,
            length: chapter.length
        };
        this.cache.set(key, data);
    }

    has(key: string): boolean {
        return this.cache.has(key);
    }

    clear(): void {
        this.cache.clear();
        this.listCache.clear();
    }

    getChapterList(key: string): CachedFeed | undefined {
        return this.listCache.get(key);
    }

    setChapterList(key: string, feed: CachedFeed): void {
        this.listCache.set(key, feed);
    }
}
