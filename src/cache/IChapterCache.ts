import { Chapter } from '../models/Chapter.js';
import { createHash } from 'crypto';

export interface IChapterCache {
    get(key: string): Chapter | undefined | Promise<Chapter | undefined>;
    set(key: string, chapter: Chapter): void | Promise<void>;
    has(key: string): boolean | Promise<boolean>;
    clear(): void | Promise<void>;
}

export class ChapterCacheKey {
    static fromUrl(url: string): string {
        return createHash('md5').update(url).digest('hex');
    }
}
