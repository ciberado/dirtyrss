import fs from 'fs';
import path from 'path';

import { Podcast } from 'podcast';
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

    static EPISODE_DOWNLOADING_MESSAGE_AUDIO_FILE_PATH = `${path.resolve('.')}/assets/downloading.aac`;

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
            console.log(`Retrieving list of episodes for channel ${this.channelName}.`);
            const opt = {
                mode: 'json' as const,
                pythonPath: '/usr/bin/python3',
                pythonOptions: [], 
                scriptPath: path.dirname(TwitchChannel.twitchDlPath),
                args: ['videos', this.channelName, '--json']
              };
        
            PythonShell.run(path.basename(TwitchChannel.twitchDlPath), opt, function (err, results) {
                if (err) reject(err);
                console.log('List of episodes retrieved.');
                resolve(results![0] as TwitchChannelData);
            });
    
        });
    }

    public async generateFeed(): Promise<string> {
        console.info(`Creating rss feed for ${this.channelName}.`);

        const twitchChannelData = await this.fetchChannelData();
        
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

    private async downloadEpisode(episodeId : string, fileName: string) {
        return new Promise((resolve, reject) => {
            const opt = {
                mode: 'text' as const,
                pythonPath: '/usr/bin/python3',
                pythonOptions: [], 
                scriptPath: path.dirname(TwitchChannel.twitchDlPath),
                args: ['download', episodeId, `--output`, fileName, `--overwrite`,
                       `--quality`, `audio_only`]
              };
        
            console.log(`Downloading episode ${episodeId} in the background`);
            PythonShell.run(path.basename(TwitchChannel.twitchDlPath), opt, function (err, results) {
                if (err) {
                    console.error(`[ERROR] Downloading twitch show ${episodeId} (${err}).`);
                    reject(err);
                }
                console.log(`Episode downloaded at ${fileName}.`);
                resolve({fileName});
            });
    
        });
    }

    public ensureEpisodeFileExists(directoryRoot: string, episodeId: string) : string {
        const fileName = `${directoryRoot}/twitch/${episodeId}.aac`;
        console.log(`Ensuring ${fileName} is available.`);

        // check if the file exists, or return the default one
        if (fs.existsSync(fileName) === false) {
            console.log(`Creating temporal symlink to default audio.`);
            fs.symlinkSync(TwitchChannel.EPISODE_DOWNLOADING_MESSAGE_AUDIO_FILE_PATH, fileName);
            this.downloadEpisode(episodeId, fileName);
        } 
        return fileName;
    }
}
