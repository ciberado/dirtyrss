import { Chapter } from '../models/Chapter.js';

export interface CachedFeed {
    chapters: Chapter[];
    isComplete: boolean;
    lastUpdate: number;
    totalVideoCount?: number; // Total de videos reportado por YouTube (puede ser > chapters.length si algunos fallaron)
}

export interface IChapterCache {
    get(key: string): Chapter | undefined | Promise<Chapter | undefined>;
    set(key: string, chapter: Chapter): void | Promise<void>;
    has(key: string): boolean | Promise<boolean>;
    clear(): void | Promise<void>;
    
    getChapterList(key: string): CachedFeed | undefined | Promise<CachedFeed | undefined>;
    setChapterList(key: string, feed: CachedFeed): void | Promise<void>;
}

export class ChapterCacheKey {
    /**
     * Genera clave para un chapter: {platform}:{podcast_name}:{chapter_id}
     */
    static forChapter(platform: string, podcastName: string, chapterId: string): string {
        return `${platform}:${podcastName}:${chapterId}`;
    }
    
    /**
     * Genera clave para un feed completo: feed:{platform}:{podcast_name}:{first_chapter_id}
     */
    static forFeedCache(platform: string, podcastName: string, firstChapterId: string): string {
        return `feed:${platform}:${podcastName}:${firstChapterId}`;
    }
}
