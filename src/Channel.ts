import { Podcast } from 'podcast';
import { Chapter } from './Chapter.js';
import { performance } from 'perf_hooks';

export abstract class Channel {
    
    protected channelName: string;
    protected description?: string;
    protected feedUrl?: string;
    protected siteUrl?: string;
    protected imageUrl?: string;
    protected author?: string;
    protected ttlInMinutes?: number;
    protected link?: string;

    constructor(channelName : string) {
        this.channelName = channelName;
    }

    protected abstract fetchChannelInformation() : Promise<void>;
    
    protected abstract fetchEpisodeList() : Promise<Chapter[]>;

    public async generateFeed(): Promise<string | undefined> {
        console.info(`Creating rss feed.`);

        console.debug(`Getting channel information.`);
        await this.fetchChannelInformation();

        console.debug(`Retrieving list of chapters.`);
        const startTime = performance.now();
        const chapters = await this.fetchEpisodeList();
        const endTime = performance.now();
        console.info(`${chapters.length} chapters found for channel ${this.channelName} in ${endTime - startTime} ms.`);

        const feed = new Podcast({
            title: this.channelName,
            author: this.author,
            description: this.description,
            imageUrl: this.imageUrl,
            ttl: this.ttlInMinutes,
            siteUrl: this.link,
            generator: 'dirtyrss'
        });

        chapters.forEach(c => {
            feed.addItem({
                title: c.title,
                date: c.date.toUTCString(),
                description: c.description,
                imageUrl: c.image,
                itunesImage : c.image,
                itunesDuration : c.duration,
                enclosure: {
                    url: c.fileUrl,
                    type: 'audio/mpeg'
                }
            });
        });

        return feed.buildXml();
    }
}