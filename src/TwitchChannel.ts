import fs from 'fs';
import path from 'path';

import { default as cheerio } from 'cheerio';
import { default as got } from 'got';
import commandExists from 'command-exists';
import { downloadRelease } from '@terascope/fetch-github-release';
import {PythonShell} from 'python-shell';

import { Chapter } from './Chapter.js';

import { Channel } from './Channel.js';

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

export class TwitchChannel extends Channel{

    static twitchDlPath : string;
    static downloadingEpisodes : { [key: string]: boolean; } = {};
    
    chapterUrlPrefix: string;

    constructor(channelName: string, chapterUrlPrefix : string) {
        super(channelName);
        this.chapterUrlPrefix = chapterUrlPrefix;
    }

    protected async fetchChannelInformation(): Promise<void> {
        const programUrl = `https://twitch.tv/${this.channelName}`;
        console.info(`Configuring feed for ${programUrl}`);
        const programResponsePage = await got(programUrl);
        const $ = cheerio.load(programResponsePage.body);

        this.author = this.channelName;
        this.description = $('.about-section *').first().text().trim();
        this.imageUrl = $('.tw-avatar img.tw-image-avatar').attr('src')?.trim();
        this.ttlInMinutes = 60;
        this.siteUrl = programUrl;        
    }

    protected async fetchEpisodeList() : Promise<Chapter[]> {
        return new Promise(async (resolve, reject) => {
            console.log(`Retrieving list of episodes for channel ${this.channelName}.`);
            const opt = {
                mode: 'json' as const,
                pythonPath: '/usr/bin/python3',
                pythonOptions: [], 
                scriptPath: path.dirname(TwitchChannel.twitchDlPath),
                args: ['videos', this.channelName, '--json']
              };

            PythonShell.run(path.basename(TwitchChannel.twitchDlPath), opt, (err, results : unknown) => {
                if (err) reject(err);
                console.log('List of episodes retrieved.');
                const twitchChapters = results as TwitchChannelData[];
                const chapters = !twitchChapters ? [] :
                    twitchChapters[0].videos.map(tc => new Chapter(
                    tc.id, tc.title, `${this.chapterUrlPrefix}/twitch/${this.channelName}/${tc.id}`, tc.title, new Date(tc.publishedAt), '', ''
                ));
                resolve(chapters);
            });
    
        });
    }

    private async downloadEpisode(episodeId : string, fileName: string) {
        return new Promise((resolve, reject) => {
            if (TwitchChannel.downloadingEpisodes[episodeId] === true) {
                console.log(`Episode ${episodeId} already being downloaded.`);
                return;
            }
            const dir = path.dirname(fileName);
            if (!fs.existsSync(dir)){
                fs.mkdirSync(dir, { recursive: true });
            }
            const opt = {
                mode: 'text' as const,
                pythonPath: '/usr/bin/python3',
                pythonOptions: [], 
                scriptPath: path.dirname(TwitchChannel.twitchDlPath),
                args: ['download', episodeId, `--output`, fileName, `--overwrite`,
                       `--quality`, `audio_only`]
              };
        
            console.log(`Downloading episode ${episodeId} in the background`);
            TwitchChannel.downloadingEpisodes[episodeId] = true;
            PythonShell.run(path.basename(TwitchChannel.twitchDlPath), opt, (err, results) => {
                delete TwitchChannel.downloadingEpisodes[episodeId];
                if (err) {
                    console.error(`[ERROR] Downloading twitch show ${episodeId} (${err}).`);
                    reject(err);
                }
                console.log(`Episode downloaded at ${fileName}.`);
                resolve({fileName});
            });
    
        });
    }

    public getFileNameForEpisode(directoryRoot: string, episodeId: string) : string | undefined {
        const fileName = `${directoryRoot}/twitch/${episodeId}.aac`;
        console.log(`Ensuring ${fileName} is available.`);

        // check if the file exists, or return the default one
        if (fs.existsSync(fileName) === false) {
            console.log(`Episode ${episodeId} not available locally.`);
            this.downloadEpisode(episodeId, fileName);
            return;
        } else {
            console.log(`Episode ${episodeId} available.`);
            return fileName;
        }
    }
}

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
} catch (err) {
    console.error(err);
    process.exit(1);
}
//# sourceMappingURL=TwitchChannel.js.map