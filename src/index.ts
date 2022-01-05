import { default as cheerio } from 'cheerio';
import { default as got } from 'got';
import { Podcast } from 'podcast';
import { default as fastify } from 'fastify';

class Chapter {
    private _id: string;
    private _title : string;
    private _fileUrl : string;
    private _description : string;
    private _date : Date;

    constructor(id: string, title: string, fileUrl : string, description : string,  date : Date) {
        this._id = id;
        this._title = title;
        this._fileUrl = fileUrl;
        this._description = description;
        this._date = date;
    }

    public get id() {
        return this._id;
    }

    public get title() {
        return this._title;
    }

    public get fileUrl() {
        return this._fileUrl;
    }

    public get description() {
        return this._description;
    }

    public get date() {
        return this._date;
    }
}

class IVoox {

    private programUrl : string;
    
    private name? : string;
    private description? : string;
    private feedUrl? : string;
    private siteUrl? : string;
    private imageUrl? : string;
    private author? : string;
    private ttlInMinutes? : number;
    private chapters?: Array<Chapter>;

    constructor(programUrl : string) {
        this.programUrl = programUrl;
    }

    private fromSpanishDate(text : string) : Date {
        const parts = text.match(/^([0-2][0-9]|3[0-1])(\/|-)(0[1-9]|1[0-2])\2(\d{4})$/);
        return new Date(parseInt(parts![4]), parseInt(parts![3])-1, parseInt(parts![1]));
    }

    private async fetchChapterData(title :string, url: string) : Promise<Chapter> {
        console.info(`Retrieving info for chapter from ${title} (${url}).`);
        const programResponsePage = await got(url);

        const $ = cheerio.load(programResponsePage.body);

        const audioUrlTempl = "https://www.ivoox.com/listenembeded_mn_12345678_1.mp3?source=EMBEDEDHTML5";

        const id = (url.match(/\d{4,8}/g))![0];
        const audioRealUrl = audioUrlTempl.replace('12345678', id);

        const description = $('.description').text().trim();

        const date = this.fromSpanishDate($('.icon-date:first').text().trim() || '01/01/2099');

        const chapter = new Chapter(id, title, audioRealUrl, description, date);

        return chapter;
    }

    public async fetch() {
        console.info(`Configuring feed from ${this.programUrl}`);
        const programResponsePage = await got(this.programUrl);
        const $ = cheerio.load(programResponsePage.body);

        this.name = $('h1').text().trim();
        this.author = $('.info a').text().trim();
        this.description = $('.overview').text().trim();
        this.imageUrl = $('.imagen-ficha img').attr('data-src')?.trim();
        this.ttlInMinutes = 60;
        this.siteUrl = this.programUrl;

        this.chapters = await Promise.all(
            [...$('.title-wrapper a')]
                .filter(a =>  a)
                .map(a => this.fetchChapterData($(a)?.text().trim(), $(a).attr('href') || ''))
        );
    }


    public generateFeed() : string {
        console.info(`Creating rss feed.`);
        const feed = new Podcast({
            title : this.name,
            author: this.author,
            description : this.description,
            imageUrl : this.imageUrl,
            ttl : this.ttlInMinutes
        });
        
        this.chapters?.forEach(c =>{
            feed.addItem({
                title : c.title,
                date : c.date.toUTCString(),
                description : c.description,
                enclosure : {
                    url : c.fileUrl,
                    type : 'audio/mpeg'
                }
            })
        });
        
        return feed.buildXml();
    }

    /**
     * 
     * @param programName The name of the program, used to perform the search
     * @returns The url of the programa with the latest chapters
     */
    static async search(programName: string) : Promise<string | undefined> {
        console.info(`Searching for the program "${programName}"`);
        programName = programName.trim().toLowerCase().replace(/ /g, '-');
        const searchURL = `https://www.ivoox.com/${programName}_sw_1_1.html`;
        const searchResponsePage = await got(searchURL);

        console.debug(`Looking for the program url.`);
        const $ = cheerio.load(searchResponsePage.body);
        const selector = `.modulo-type-programa .header-modulo a`;
        const anchor = $(selector);

        const programUrl = anchor.attr('href')?.toString();
        console.debug(`Program url: ${programUrl}.`);

        return programUrl;
    }

}

async function main() {
    const programUrl = await IVoox.search('la voz de horus');

    if (programUrl === undefined) {
        throw new Error(`URL not found for the program ${programUrl}.`);
    }
    const ivoox = new IVoox(programUrl);
    await ivoox.fetch();
    const xmlFeed = ivoox.generateFeed();    

    const app = fastify();
    app.get('/', async (req, reply) => {
        reply.send(xmlFeed);
    });
    app.listen(3000, '0.0.0.0', function (err, address) {
        console.log(`Server started.`);
    });
}

main();

