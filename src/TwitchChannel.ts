import { Podcast } from 'podcast';
import { default as path } from 'path';
import commandExists from 'command-exists';
import { downloadRelease } from '@terascope/fetch-github-release';
import {PythonShell} from 'python-shell';

interface TwitchVideoData {
    id: string;
    title: string;
    publishedAt : string;
    creator : {
        login : string,
        displayName : string
    }
}

interface TwitchChannelData {
    count : number;
    totalCount : number,
    videos : TwitchVideoData[];
}

export class TwitchChannel {

    static twitchDlPath : string;

    channelName : string;

    static async ensureTwitchDl() : Promise<string> {
        try {
            console.debug(`Checking for Python3.`);
            const python3Exists = commandExists.sync('python3');
            if (python3Exists === false) {
                throw 'Python3 not found in PATH. Please install it from https://www.python.org/downloads.';
            }
            console.info(`Python3 detected!`);

            console.debug(`Checking for ffmpeg.`);
            const ffmpegExists = commandExists.sync('ffmpeg');
            if (ffmpegExists === false) {
                throw 'ffmpeg not found in PATH. Please install it from https://www.ffmpeg.org/download.html.';
            }
            console.info(`ffmpeg detected!`);

            const twitchdl : string[] = await downloadRelease(
                'ihabunek', 'twitch-dl', '/tmp', 
                (r: any) => true,
                (a: any) => a.name.includes('pyz'),
                true, false);
            TwitchChannel.twitchDlPath = twitchdl[0];
            console.info(`TwitchDL downloaded at ${TwitchChannel.twitchDlPath}.`);
            return TwitchChannel.twitchDlPath;
        } catch (err) {
            console.error(err);
            process.exit(1);
        }

    }

    constructor(channelName: string) {
        this.channelName = channelName;
    }

    private async fetchChannelData() : Promise<TwitchChannelData>{
        return new Promise((resolve, reject) => {
            const opt = {
                mode: 'json' as const,
                pythonPath: '/usr/bin/python3',
                pythonOptions: [], 
                scriptPath: path.dirname(TwitchChannel.twitchDlPath),
                args: ['videos', this.channelName, '--json']
              };
        
            console.log(`wop`);
            PythonShell.run(path.basename(TwitchChannel.twitchDlPath), opt, function (err, results) {
                if (err) reject(err);
                console.log('finished');
                resolve(results![0] as TwitchChannelData);
            });
    
        });
    }

    public async generateFeed(): Promise<string> {
        console.info(`Creating rss feed for ${this.channelName}.`);

        const twitchChannelData = await this.fetchChannelData();
console.log(JSON.stringify(twitchChannelData))
        const feed = new Podcast({
            title: this.channelName,
            author: twitchChannelData.count === 0 ? 
                    this.channelName : twitchChannelData.videos[0].creator.displayName,
            description: this.channelName,
            imageUrl: 'https://placekitten.com/100/100',
            ttl: 60
        });

        twitchChannelData.videos.forEach(c => {
            feed.addItem({
                title: c.title,
                date: c.publishedAt,
                description: c.title,
                enclosure: {
                    url: `/twitch/${this.channelName}/${c.id}`,
                    type: 'audio/mpeg'
                }
            });
        });

        return feed.buildXml();
    }

}
