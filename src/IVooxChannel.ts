import { default as cheerio } from 'cheerio';
import { default as got } from 'got';
import { Chapter } from './Chapter.js';

import { Channel } from './Channel.js';

export class IVooxChannel extends Channel {

    private programUrl? : string;

    constructor(channelName: string) {
        super(channelName);
    }

    private fromSpanishDate(text: string): Date {
        const parts = text.match(/^([0-2][0-9]|3[0-1])(\/|-)(0[1-9]|1[0-2])\2(\d{4})$/);
        return new Date(parseInt(parts![4]), parseInt(parts![3]) - 1, parseInt(parts![1]));
    }

    protected async fetchEpisodeList() : Promise<Chapter[]> {
        console.info(`Configuring feed from ${this.programUrl}`);
        const programResponsePage = await got(this.programUrl || '');
        const $ = cheerio.load(programResponsePage.body);

        super.channelName = $('h1').text().trim();
        super.author = $('.info a').text().trim();
        super.description = $('.overview').text().trim();
        super.imageUrl = $('.imagen-ficha img').attr('data-src')?.trim();
        super.ttlInMinutes = 60;
        super.siteUrl = this.programUrl;

        const chapters = await Promise.all(
            [...$('.title-wrapper a')]
                .filter(a => a)
                .map(a => this.fetchChapterData($(a)?.text().trim(), $(a).attr('href') || ''))
        );
        return chapters;
    }

    protected async fetchChapterData(title: string, url: string): Promise<Chapter> {
        console.debug(`Retrieving info for chapter from ${title} (${url}).`);
        const programResponsePage = await got(url);

        const $ = cheerio.load(programResponsePage.body);

        const audioUrlTempl = "https://www.ivoox.com/listenembeded_mn_12345678_1.mp3?source=EMBEDEDHTML5";

        const id = (url.match(/\d{6,12}/g))![0];
        const audioRealUrl = audioUrlTempl.replace('12345678', id);

        const description = $('.description').text().trim();

        const date = this.fromSpanishDate($('.icon-date:first').text().trim() || '01/01/2099');

        const chapter = new Chapter(id, title, audioRealUrl, description, date);

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
        this.programUrl = await this.findChannelUrl();
        if (this.programUrl === undefined) {
            console.warn(`Channel url not found for ${this.channelName}.`);
            return;
        }
        console.info(`Channel url is ${this.programUrl}.`);
        return super.generateFeed();
    }

}
