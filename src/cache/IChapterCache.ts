import { Chapter } from '../models/Chapter.js';
import { createHash } from 'crypto';

export interface IChapterCache {
    get(key: string): Chapter | undefined | Promise<Chapter | undefined>;
    set(key: string, chapter: Chapter): void | Promise<void>;
    has(key: string): boolean | Promise<boolean>;
    clear(): void | Promise<void>;
    
    getChapterList(key: string): Chapter[] | undefined | Promise<Chapter[] | undefined>;
    setChapterList(key: string, chapters: Chapter[]): void | Promise<void>;
}

export class ChapterCacheKey {
    static fromUrl(url: string): string {
        return createHash('md5').update(`url:${url}`).digest('hex');
    }
    
    static fromId(source: string, id: string): string {
        return createHash('md5').update(`${source}:${id}`).digest('hex');
    }
    
    static forFeedCache(channelUrl: string, firstChapter: Chapter): string {
        const chapterHash = createHash('md5').update(
            `${firstChapter.id}:${firstChapter.title}:${firstChapter.date.getTime()}`
        ).digest('hex');
        return createHash('md5').update(`feed:${channelUrl}:${chapterHash}`).digest('hex');
    }
}
