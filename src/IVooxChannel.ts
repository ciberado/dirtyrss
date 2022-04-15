import { default as cheerio } from 'cheerio';
import { default as got } from 'got';
import { Podcast } from 'podcast';
import { Chapter } from './Chapter.js';

export class IVooxChannel {

    private channelName: string;
    private description?: string;
    private feedUrl?: string;
    private siteUrl?: string;
    private imageUrl?: string;
    private author?: string;
    private ttlInMinutes?: number;

    constructor(channelName: string) {
        this.channelName= channelName;
    }

    private fromSpanishDate(text: string): Date {
        const parts = text.match(/^([0-2][0-9]|3[0-1])(\/|-)(0[1-9]|1[0-2])\2(\d{4})$/);
        return new Date(parseInt(parts![4]), parseInt(parts![3]) - 1, parseInt(parts![1]));
    }

    private async fetchChapterData(title: string, url: string): Promise<Chapter> {
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

    private async fetchEpisodeList(programUrl : string) : Promise<Chapter[]> {
        console.info(`Configuring feed from ${programUrl}`);
        const programResponsePage = await got(programUrl);
        const $ = cheerio.load(programResponsePage.body);

        this.channelName = $('h1').text().trim();
        this.author = $('.info a').text().trim();
        this.description = $('.overview').text().trim();
        this.imageUrl = $('.imagen-ficha img').attr('data-src')?.trim();
        this.ttlInMinutes = 60;
        this.siteUrl = programUrl;

        const chapters = await Promise.all(
            [...$('.title-wrapper a')]
                .filter(a => a)
                .map(a => this.fetchChapterData($(a)?.text().trim(), $(a).attr('href') || ''))
        );
        return chapters;
    }

    private async findChannelUrl(): Promise<string | null> {
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

        return programUrl === undefined ? null : programUrl;
    }

    public async generateFeed(): Promise<string | null> {
        console.info(`Creating rss feed.`);

        console.debug(`Getting channel ${this.channelName} url.`);
        const programUrl = await this.findChannelUrl();
        if (programUrl === null) {
            console.warn(`Channel url not found for ${this.channelName}.`);
            return null;
        }

        console.info(`Channel url is ${programUrl}.`);
        console.debug(`Retrieving list of chapters.`);
        const chapters = await this.fetchEpisodeList(programUrl);
        console.info(`${chapters.length} chapters found for channel ${this.channelName}.`);

        const feed = new Podcast({
            title: this.channelName,
            author: this.author,
            description: this.description,
            imageUrl: this.imageUrl,
            ttl: this.ttlInMinutes
        });

        chapters.forEach(c => {
            feed.addItem({
                title: c.title,
                date: c.date.toUTCString(),
                description: c.description,
                enclosure: {
                    url: c.fileUrl,
                    type: 'audio/mpeg'
                }
            });
        });

        return feed.buildXml();
    }


}
