import { default as cheerio } from 'cheerio';
import { default as got } from 'got';
import { Podcast } from 'podcast';
import { default as fastify } from 'fastify';

class Chapter {
    private _id: string;
    private _title : string;
    private _fileUrl : string;

    constructor(id: string, title: string, fileUrl : string) {
        this._id = id;
        this._title = title;
        this._fileUrl = fileUrl;
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

        const t = "https://www.ivoox.com/listenembeded_mn_12345678_1.mp3?source=EMBEDEDHTML5";
        this.chapters = [...$('.title-wrapper a')]
            .filter(a =>  a)
            .map(a => ({title : $(a)?.text().trim(), id : $(a).attr('href')?.match(/\d{4,8}/g)![0] }))
            .map(d => new Chapter(d.id || d.title, d.title, t.replace('12345678', d.id || '')));
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
        
        this.chapters?.forEach(p =>{
            feed.addItem({
                title : p.title,
                enclosure : {
                    url : p.fileUrl,
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

