import * as cheerio from "cheerio"; 
import { default as got } from 'got';
import { Chapter } from '../models/Chapter.js';
import { Channel } from './Channel.js';
import { ChapterCacheKey } from '../cache/IChapterCache.js';

export class LavanguardiaChannel extends Channel {

    protected channelUrl: string;

    constructor(channelName: string) {
        super(channelName);
        this.channelUrl = `https://www.lavanguardia.com/autores/${channelName}.html`;
    }

    protected async fetchChannelInformation(): Promise<void> {
        console.info(`Configuring feed from ${this.channelUrl}`);
        const channelResponsePage = await got(this.channelUrl);
        const channelPageHtml = channelResponsePage.body;
        const $channelPage = cheerio.load(channelPageHtml);
        
        this.channelName = $channelPage('.author-opinion-name').text().trim();
        this.author = $channelPage('.author-opinion-name').text().trim();
        this.description = $channelPage('.bio').text().trim();
        this.imageUrl = $channelPage('.author-opinion-image.img-opinion > img').attr('src')?.trim();
        this.ttlInMinutes = 60 * 12;
        this.siteUrl = this.channelUrl;
        this.link = this.channelUrl;
    }

    protected async fetchChapterData(fileUrl: string): Promise<Chapter> {
        const cacheKey = ChapterCacheKey.fromUrl(fileUrl);
        
        const cachedChapter = await Channel.chapterCache.get(cacheKey);
        if (cachedChapter) {
            return cachedChapter;
        }

        const chapterResponsePage = await got(fileUrl);
        const chapterPageHtml = chapterResponsePage.body;
        const $ = cheerio.load(chapterPageHtml);

        const id = fileUrl.match(/\/(\d+)\/[^/]+$/)?.[1] || '';
        console.log(`Fetching chapter ${id} from ${fileUrl}`);
        const title = $('h1').text().trim();
        const description = 
            $('p.paragraph, .article-media-main img').map((i, el) => $(el).prop('outerHTML')).get().join('\n').trim();
        const date = $('.created').attr('datetime')?.trim() || '';
        const image = $('.article-media-main img').attr('data-full-src')?.trim() || $('.article-media-main img').attr('data-src')?.trim()!;
        const duration = '';

        const chapter = new Chapter(id, title, fileUrl, description, new Date(date), image, duration);
        
        Channel.chapterCache.set(cacheKey, chapter);
        
        return chapter;
    }

    protected async fetchEpisodeList() : Promise<Chapter[]> {
        const chapters: Chapter[] = [];
        const channelResponsePage = await got(this.channelUrl);
        const $ = cheerio.load(channelResponsePage.body);
        const $articles = $('article');
        for (let index = 0; index < $articles.length; index++) {
            const $article = $($articles[index]);
            const fileUrl = 'https://www.lavanguardia.com' + $article.find('a.page-link').attr('href')!.trim();

            const chapter = await this.fetchChapterData(fileUrl);
            chapters.push(chapter);
        }

        return chapters;
    }

}

