import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

import * as cheerio from "cheerio"; 
import { default as got } from 'got';
import commandExists from 'command-exists';
import { downloadRelease } from '@terascope/fetch-github-release';
import {PythonShell} from 'python-shell';

import { Chapter } from '../models/Chapter.js';
import { Channel } from './Channel.js';
import { ChapterCacheKey } from '../cache/IChapterCache.js';

interface TwitchVideoData {
    id: string;
    title: string;
    publishedAt : string;
    lengthSeconds: number;
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
    
    private allVideosData: TwitchVideoData[] | null = null;
    
    chapterUrlPrefix: string;
    username: string;
    staticFilesPath: string;

    constructor(channelName: string, chapterUrlPrefix : string, staticFilesPath: string = '/tmp/public') {
        super(channelName);
        this.chapterUrlPrefix = chapterUrlPrefix;
        this.username = channelName;
        this.staticFilesPath = staticFilesPath;
    }

    protected async fetchChannelInformation(): Promise<void> {
        const programUrl = `https://twitch.tv/${this.channelName}`;
        console.info(`Configuring feed for ${programUrl}`);
        const programResponsePage = await got(programUrl);
        const $ = cheerio.load(programResponsePage.body);

        this.username = this.channelName.toString();
        this.author = this.channelName.toString();
        this.channelName = $('meta[name="title"]').attr('content')?.trim() || this.channelName;
        this.description = $('meta[property="og:description"]').attr('content')?.trim();
        this.imageUrl = $('meta[property="og:image"]').attr('content')?.trim();
        this.ttlInMinutes = 60;
        this.siteUrl = programUrl;
        this.link = programUrl;  
    }

    private async fetchAllVideosData(): Promise<TwitchVideoData[]> {
        if (this.allVideosData !== null) {
            return this.allVideosData;
        }

        return new Promise(async (resolve, reject) => {
            console.log(`Retrieving list of episodes for channel ${this.channelName}.`);
            const opt = {
                mode: 'json' as const,
                pythonPath: '/usr/bin/python3',
                pythonOptions: [], 
                scriptPath: path.dirname(TwitchChannel.twitchDlPath),
                args: ['videos', this.username, '--json']
            };

            PythonShell.run(path.basename(TwitchChannel.twitchDlPath), opt, (err, results : unknown) => {
                if (err) {
                    reject(err);
                    return;
                }
                console.log('List of episodes retrieved.');
                const twitchChapters = results as TwitchChannelData[];
                const videos = !twitchChapters ? [] : twitchChapters[0].videos;
                this.allVideosData = videos;
                resolve(videos);
            });
        });
    }

    protected async fetchChapterData(id: string): Promise<Chapter> {
        const cacheKey = ChapterCacheKey.fromId('twitch', id);
        
        const cachedChapter = await Channel.chapterCache.get(cacheKey);
        if (cachedChapter) {
            return cachedChapter;
        }

        const videos = await this.fetchAllVideosData();
        const tc = videos.find(v => v.id === id);
        
        if (!tc) {
            throw new Error(`Video ${id} not found for channel ${this.channelName}`);
        }

        let duration = '';
        if (tc.lengthSeconds) {
            const hours = Math.floor(tc.lengthSeconds / 3600);
            const minutes = Math.floor((tc.lengthSeconds % 3600) / 60);
            const seconds = tc.lengthSeconds % 60;
            duration = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        
        let fileSize = 5 * 60 * 1024 * 1024;
        const filePath = `${this.staticFilesPath}/twitch/${tc.id}.mp3`;
        try {
            if (fs.existsSync(filePath)) {
                fileSize = fs.statSync(filePath).size;
            }
        } catch (err) {
            // Use default size
        }
        
        const chapter = new Chapter(
            tc.id, 
            tc.title, 
            `${this.chapterUrlPrefix}/twitch/${this.username}/${tc.id}.mp3`, 
            tc.title, 
            new Date(tc.publishedAt), 
            '', 
            duration, 
            'audio/mpeg', 
            fileSize
        );

        Channel.chapterCache.set(cacheKey, chapter);
        
        return chapter;
    }

    protected async fetchEpisodeList() : Promise<Chapter[]> {
        const videos = await this.fetchAllVideosData();
        
        const chapters = await Promise.all(
            videos.map(tc => this.fetchChapterData(tc.id))
        );
        
        return chapters;
    }

    private async downloadEpisode(episodeId : string, fileName: string) {
        return new Promise((resolve, reject) => {
            if (TwitchChannel.downloadingEpisodes[episodeId] === true) {
                console.log(`Episode ${episodeId} already being downloaded.`);
                return;
            }
            
            const tempMp3File = fileName.replace('.mp3', '.tmp.mp3');
            if (fs.existsSync(tempMp3File)) {
                console.log(`Episode ${episodeId} is already being converted (${tempMp3File} exists).`);
                return;
            }
            
            const dir = path.dirname(fileName);
            if (!fs.existsSync(dir)){
                fs.mkdirSync(dir, { recursive: true });
            }
            
            const tempM4aFile = fileName.replace('.mp3', '.m4a');
            const opt = {
                mode: 'text' as const,
                pythonPath: '/usr/bin/python3',
                pythonOptions: [], 
                scriptPath: path.dirname(TwitchChannel.twitchDlPath),
                args: ['download', episodeId, `--output`, tempM4aFile, `--overwrite`,
                       `--quality`, `audio_only`]
              };
        
            console.log(`Downloading episode ${episodeId} in the background`);
            TwitchChannel.downloadingEpisodes[episodeId] = true;
            PythonShell.run(path.basename(TwitchChannel.twitchDlPath), opt, (err, results) => {
                if (err) {
                    delete TwitchChannel.downloadingEpisodes[episodeId];
                    console.error(`[ERROR] Downloading twitch show ${episodeId} (${err}).`);
                    reject(err);
                    return;
                }
                console.log(`Episode downloaded at ${tempM4aFile}, converting to MP3...`);
                
                // Convert M4A to MP3 using ffmpeg to a temp file, then move
                const tempMp3File = fileName.replace('.mp3', '.tmp.mp3');
                exec(`ffmpeg -i "${tempM4aFile}" -codec:a libmp3lame -qscale:a 2 "${tempMp3File}" -y`, (convertErr: any) => {
                    delete TwitchChannel.downloadingEpisodes[episodeId];
                    if (convertErr) {
                        console.error(`[ERROR] Converting ${episodeId} to MP3 (${convertErr}).`);
                        reject(convertErr);
                        return;
                    }
                    // Delete temp M4A file
                    fs.unlinkSync(tempM4aFile);
                    // Move temp MP3 to final name (atomic operation)
                    fs.renameSync(tempMp3File, fileName);
                    console.log(`Episode converted to MP3 at ${fileName}.`);
                    resolve({fileName});
                });
            });
    
        });
    }

    public getFileNameForEpisode(directoryRoot: string, episodeId: string) : string | undefined {
        const fileName = `${directoryRoot}/twitch/${episodeId}.mp3`;
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
    //process.exit(1);
}
//# sourceMappingURL=TwitchChannel.js.map