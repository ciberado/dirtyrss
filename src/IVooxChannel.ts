import * as cheerio from 'cheerio';
import { pRateLimit } from 'p-ratelimit';
import { default as got } from 'got';
import { Chapter } from './Chapter.js';
import { Channel } from './Channel.js';
import NodeCache from 'node-cache';

export class IVooxChannel extends Channel {

    private static readonly MAX_CHAPTERS_PER_PAGE = 20;
    private static readonly MAX_CALLS_PER_SECOND = 90;

    private channelUrl? : string;
    private channelPageHtml?: string;
    private numChapters?:number;

    constructor(channelName: string) {
        super(channelName);
    }

    private fromSpanishDate(text: string): Date {
        const parts = text.split(/[\/·:]/);
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);

        return new Date(year, month, day);
    }

    protected async fetchChannelInformation(): Promise<void> {
        console.info(`Configuring feed from ${this.channelUrl}`);
        const channelResponsePage = await got(this.channelUrl || '');
        const $ = cheerio.default;
        this.channelPageHtml = channelResponsePage.body;
        const $channelPage = $.load(this.channelPageHtml);

        this.channelName = $channelPage('h1').text().trim();
        this.author = $channelPage('.d-flex > .text-medium > . a').text().trim();
        this.description = $channelPage('.d-flex > .d-none > .text-truncate-3').text().trim();
        this.imageUrl = $channelPage('.d-flex > .image-wrapper.pr-2 > img').attr('data-lazy-src')?.trim();
        this.ttlInMinutes = 60;
        this.siteUrl = this.channelUrl;
        this.numChapters = parseInt($channelPage('.stat > .text-gray:first').text().replace('.','').trim());
        this.link = this.channelUrl;
    }

    protected async fetchEpisodeList(): Promise<Chapter[]> {
        console.log(`Chapters: ${this.numChapters}`);
        const maxPageNumber = Math.min(this.numChapters? await this.calculateMaxPageNumber() : 1, 999);
        const pageNumbers = Array.from({ length: maxPageNumber }, (_, i) => i + 1);
    
        const allChapters = await Promise.all(
            pageNumbers.map(page => this.fetchPageEpisodeList(page))
        );
    
        return allChapters.flat();
    }

    private async calculateMaxPageNumber() : Promise<number> {
        return this.numChapters?Math.ceil(this.numChapters/IVooxChannel.MAX_CHAPTERS_PER_PAGE):3;
    }

    private async fetchPageEpisodeList(pageNumber: number) : Promise<Chapter[]> {

        const $ = cheerio.load('');

        const currentPageUrl = this.channelUrl?.replace('_1.html', `_${pageNumber}.html`);
        console.log(`++Fetching page ${pageNumber} from ${currentPageUrl}`);

        const channelResponsePage = await IVooxChannel.limit(async () => await got(currentPageUrl || ''));
        const $channelPage = cheerio.load(channelResponsePage.body || '');
        

        const selector = `.pl-1 > .d-flex > .d-flex > .w-100 > a`;

        const chapters = await Promise.all(
              [...$channelPage(selector)]
                .filter(a => a)
                .map(a => this.fetchChapterData($(a).text().trim(), `https://ivoox.com${$(a).attr('href')}` || ''))
        );
        return chapters;
    }

    private async fetchChapterData(title: string, url: string): Promise<Chapter> {
        const cacheKey = `chapter_${url}`;
        
        const cachedChapter = IVooxChannel.chapterCache.get<Chapter>(cacheKey);
        if (cachedChapter) {
            return cachedChapter;
        }
        
        const programResponsePage = await IVooxChannel.limit(async () => await got(url));
        console.debug(`Retrieved info for podcast "${this.channelName}" chapter "${title}", url=(${url}).`);

        const $chapterPage = cheerio.load(programResponsePage.body);

        const audioUrlTempl = "https://www.ivoox.com/listenembeded_mn_12345678_1.mp3?source=EMBEDEDHTML5";

        const id = (url.match(/\d{6,12}/g))![0];
        const audioRealUrl = audioUrlTempl.replace('12345678', id);

        const description = $chapterPage('div.mb-3 > div > p.text-truncate-5').text().trim();

        const date = this.fromSpanishDate($chapterPage('span.text-medium.ml-sm-1').text().split('·')[0].trim() || '01/01/2000');
        const duration = $chapterPage('span.text-medium.ml-sm-1').text().split('·')[1].trim() || '00:00';

        let img = ($chapterPage('.d-flex > .image-wrapper.pr-2 > img').attr('data-lazy-src') || '').trim();
        if (img.includes('url=')) {
            img = img.split('url=')[1];
        }
        img = `https://img-static.ivoox.com/index.php?w=175&h=175&url=${img}`;

        const chapter = new Chapter(id, title, audioRealUrl, description, date, img, duration);
        
        IVooxChannel.chapterCache.set(cacheKey, chapter);

        return chapter;
    }

    private async findChannelUrl(): Promise<string | undefined> {
        console.info(`Searching for the program "${this.channelName}"`);
        const normalizedName = this.channelName.trim().toLowerCase().replace(/ /g, '-');
        const searchURL = `https://www.ivoox.com/${normalizedName}_sw_1_1.html`;
        const searchResponsePage = await got(searchURL);

        console.debug(`Looking for the program url.`);
        const $ = cheerio.load(searchResponsePage.body);
        const selector = `.modulo-type-programa .header-modulo a`;
        const anchor = $(selector);

        const programUrl = anchor.attr('href')?.toString();
        console.debug(`Program url: ${programUrl}.`);

        return programUrl;
    }

   public async generateFeed(): Promise<string | undefined> {
        console.info(`Creating rss feed.`);
        console.debug(`Getting channel ${this.channelName} url.`);
        this.channelUrl = await this.findChannelUrl();
        if (this.channelUrl === undefined) {
            console.warn(`Channel url not found for ${this.channelName}.`);
            return;
        }
        console.info(`Channel url is ${this.channelUrl}.`);
        return super.generateFeed();
    }

    private static limit = pRateLimit({
        interval: 1000,             // 1000 ms == 1 second
        rate: IVooxChannel.MAX_CALLS_PER_SECOND,                   // 60 API calls per interval
        concurrency: IVooxChannel.MAX_CALLS_PER_SECOND*1.2,            // no more than 80 running at once
        maxDelay: 5 * 60000              // an API call delayed > 2 sec is rejected
    });

    private static chapterCache: NodeCache = new NodeCache({ 
        stdTTL: 3600*24, // Tiempo de vida en segundos
        checkperiod: 600 // Verificar expiración cada 60 minutos
    });
}
//# sourceMappingURL=IVooxChannel.js.map