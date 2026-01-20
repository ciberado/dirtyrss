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
        // Usar id, title y fileUrl para identificar el primer capítulo
        // Son los campos realmente importantes y estables
        return createHash('md5').update(
            `feed:${channelUrl}:${firstChapter.id}:${firstChapter.title}:${firstChapter.fileUrl}`
        ).digest('hex');
    }
}
