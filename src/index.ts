import fs from 'fs';
import path from 'path';
import fse from 'fs-extra';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { IVooxChannel } from './channels/IVooxChannel.js';
import { TwitchChannel } from './channels/TwitchChannel.js';
import { LavanguardiaChannel } from './channels/LavanguardiaChannel.js';
import { YoutubeChannel } from './channels/YoutubeChannel.js';
import { YoutubePlaylist } from './channels/YoutubePlaylist.js';
import { YoutubeAudioDownloader } from './utils/YoutubeAudioDownloader.js';
import { Channel } from './channels/Channel.js';
import { ChapterCacheKey } from './cache/IChapterCache.js';

const FASTIFY_PORT = parseInt(process.env.PORT!) || 3000;

const FASTIFY_STATIC = '/tmp/public';
const PUBLIC_ASSETS_DIRECTORY = `${path.resolve('.')}/assets/public/`;

fse.copySync(PUBLIC_ASSETS_DIRECTORY, `${FASTIFY_STATIC}/assets`);

const fastify = Fastify({
    trustProxy: true
});

/**
 * Helper para loguear información del capítulo desde caché cuando se intenta descargar
 */
async function logChapterDownloadAttempt(platform: string, showId: string, episodeId: string): Promise<void> {
    try {
        const cacheKey = ChapterCacheKey.forChapter(platform, showId, episodeId);
        const cachedChapter = await Channel.chapterCache.get(cacheKey);
        
        if (cachedChapter) {
            console.log(`[DOWNLOAD ATTEMPT] Cache key: ${cacheKey} | Title: "${cachedChapter.title}"`);
        } else {
            console.log(`[DOWNLOAD ATTEMPT] Cache key: ${cacheKey} | (not in cache)`);
        }
    } catch (error) {
        console.error(`[DOWNLOAD ATTEMPT] Error reading cache for ${platform}:${showId}:${episodeId}:`, error);
    }
}

// Memory monitoring hook
fastify.addHook('onResponse', (req, reply, done) => {
    const used = process.memoryUsage();
    const rssMB = Math.round(used.rss / 1024 / 1024);
    
    // Cloudflare usa CF-Connecting-IP, sino X-Forwarded-For, sino req.ip
    const cfIp = req.headers['cf-connecting-ip'];
    const xForwardedFor = req.headers['x-forwarded-for'];
    const clientIp = cfIp || 
                     (typeof xForwardedFor === 'string' ? xForwardedFor.split(',')[0].trim() : xForwardedFor?.[0]) || 
                     req.ip;
    
    console.log(`[MEMORY] ${rssMB}MB | ${clientIp} | ${req.method} ${req.url} - ${reply.statusCode}`);
    done();
});

if (fs.existsSync(FASTIFY_STATIC) === false) {
    fs.mkdirSync(FASTIFY_STATIC, { recursive : true});
}
fastify.register(fastifyStatic, {
    root : FASTIFY_STATIC,
    acceptRanges : true
});

// Health check and memory monitoring endpoint
fastify.get('/health', async (req, reply) => {
    const used = process.memoryUsage();
    
    reply.send({
        status: 'ok',
        uptime: process.uptime(),
        memory: {
            heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`,
            external: `${Math.round(used.external / 1024 / 1024)}MB`,
            rss: `${Math.round(used.rss / 1024 / 1024)}MB`,
            arrayBuffers: `${Math.round(used.arrayBuffers / 1024 / 1024)}MB`
        },
        memoryRaw: {
            heapUsed: used.heapUsed,
            heapTotal: used.heapTotal,
            external: used.external,
            rss: used.rss,
            arrayBuffers: used.arrayBuffers
        }
    });
});

interface YoutubeChannelParamType {
    channelId: string;
}

interface YoutubePlaylistParamType {
    playlistId: string;
}

interface YoutubeChannelAudioParamType {
    channelId: string;
    videoId: string;
}

interface YoutubePlaylistAudioParamType {
    playlistId: string;
    videoId: string;
}

fastify.get<{Params : YoutubeChannelParamType}>('/youtube/channel/:channelId', async (req, reply) => {
    try {
        const defaultPort = req.protocol === 'https' ? 443 : 80;
        const port = req.port || defaultPort;
        const portSuffix = (port === 80 && req.protocol === 'http') || (port === 443 && req.protocol === 'https') ? '' : `:${port}`;
        const chapterUrlPrefix = process.env.EPISODE_PREFIX || `${req.protocol}://${req.hostname}${portSuffix}`;
        
        const yc = new YoutubeChannel(req.params.channelId, chapterUrlPrefix, FASTIFY_STATIC);
        const xmlFeed = await yc.generateFeed();
        
        if (xmlFeed === undefined) {
            reply.code(404).type('text/html').send(`YouTube channel ${req.params.channelId} not found.`);
        } else {
            reply.send(xmlFeed);
        }
    } catch (err) {
        console.warn(err);
        reply.code(500).send(`Error: ${err}`);
    }
});

fastify.get<{Params : YoutubePlaylistParamType}>('/youtube/playlist/:playlistId', async (req, reply) => {
    try {
        const defaultPort = req.protocol === 'https' ? 443 : 80;
        const port = req.port || defaultPort;
        const portSuffix = (port === 80 && req.protocol === 'http') || (port === 443 && req.protocol === 'https') ? '' : `:${port}`;
        const chapterUrlPrefix = process.env.EPISODE_PREFIX || `${req.protocol}://${req.hostname}${portSuffix}`;
        
        const yp = new YoutubePlaylist(req.params.playlistId, chapterUrlPrefix, FASTIFY_STATIC);
        const xmlFeed = await yp.generateFeed();
        
        if (xmlFeed === undefined) {
            reply.code(404).type('text/html').send(`YouTube playlist ${req.params.playlistId} not found.`);
        } else {
            reply.send(xmlFeed);
        }
    } catch (err) {
        console.warn(err);
        reply.code(500).send(`Error: ${err}`);
    }
});

// Endpoint para servir audio de YouTube (canal)
fastify.get<{Params : YoutubeChannelAudioParamType}>('/youtube/channel/:channelId/:videoId.m4a', async (req, reply) => {
    try {
        const { channelId, videoId } = req.params;
        const audioDir = path.join(FASTIFY_STATIC, 'youtube-audio');
        
        // Log del intento de descarga con información de caché
        await logChapterDownloadAttempt('youtube', channelId, videoId);
        
        const fileName = YoutubeAudioDownloader.getFileNameForVideo(audioDir, videoId);
        
        if (!fileName) {
            console.info(`[YOUTUBE AUDIO] Video ${videoId} not ready yet, triggering download`);
            YoutubeAudioDownloader.downloadInBackground(videoId, audioDir);
            return reply.code(503).type('text/html').send(`Video ${videoId} is being downloaded. Please try again in a few minutes.`);
        }
        
        // Servir el archivo con soporte de range requests
        const stat = fs.statSync(fileName);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;
            const stream = fs.createReadStream(fileName, { start, end });
            
            reply
                .code(206)
                .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
                .header('Accept-Ranges', 'bytes')
                .header('Content-Length', chunkSize)
                .header('Content-Type', 'audio/mp4');
            
            return reply.send(stream);
        } else {
            reply
                .header('Content-Type', 'audio/mp4')
                .header('Content-Length', fileSize)
                .header('Accept-Ranges', 'bytes');
            
            const stream = fs.createReadStream(fileName);
            return reply.send(stream);
        }
    } catch (err) {
        console.error(err);
        reply.code(500).send(`Error serving audio: ${err}`);
    }
});

// Endpoint para servir audio de YouTube (playlist)
fastify.get<{Params : YoutubePlaylistAudioParamType}>('/youtube/playlist/:playlistId/:videoId.m4a', async (req, reply) => {
    try {
        const { playlistId, videoId } = req.params;
        const audioDir = path.join(FASTIFY_STATIC, 'youtube-audio');
        
        // Log del intento de descarga con información de caché
        await logChapterDownloadAttempt('youtube-playlist', playlistId, videoId);
        
        const fileName = YoutubeAudioDownloader.getFileNameForVideo(audioDir, videoId);
        
        if (!fileName) {
            console.info(`[YOUTUBE AUDIO] Video ${videoId} not ready yet, triggering download`);
            YoutubeAudioDownloader.downloadInBackground(videoId, audioDir);
            return reply.code(503).type('text/html').send(`Video ${videoId} is being downloaded. Please try again in a few minutes.`);
        }
        
        // Servir el archivo con soporte de range requests
        const stat = fs.statSync(fileName);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;
            const stream = fs.createReadStream(fileName, { start, end });
            
            reply
                .code(206)
                .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
                .header('Accept-Ranges', 'bytes')
                .header('Content-Length', chunkSize)
                .header('Content-Type', 'audio/mp4');
            
            return reply.send(stream);
        } else {
            reply
                .header('Content-Type', 'audio/mp4')
                .header('Content-Length', fileSize)
                .header('Accept-Ranges', 'bytes');
            
            const stream = fs.createReadStream(fileName);
            return reply.send(stream);
        }
    } catch (err) {
        console.error(err);
        reply.code(500).send(`Error serving audio: ${err}`);
    }
});

interface LavanguardiaParamType {
    author : string;
}

fastify.get<{Params : LavanguardiaParamType}>('/lavanguardia/:author', async (req, reply) => {
    try {
        const lvc = new LavanguardiaChannel(req.params.author);
        const xmlFeed = await lvc.generateFeed();
        reply.send(xmlFeed);            
    } catch (err) {
        console.warn(err);
        reply.code(404).type('text/html').send(`Podcast ${req.params.author} not found (${err}).`);
    }
});


interface TwitchParamType {
    showId : string;
    episodeId: string;
}

fastify.get<{Params : TwitchParamType}>('/twitch/:showId', async (req, reply) => {
    try {
        const defaultPort = req.protocol === 'https' ? 443 : 80;
        const port = req.port || defaultPort;
        const portSuffix = (port === 80 && req.protocol === 'http') || (port === 443 && req.protocol === 'https') ? '' : `:${port}`;
        console.info(`[REQUEST] ${req.method} ${req.protocol}://${req.hostname}${portSuffix}${req.url}`);
        const chapterUrlPrefix = process.env.EPISODE_PREFIX || `${req.protocol}://${req.hostname}${portSuffix}`;
        console.log("chapterUrlPrefix", chapterUrlPrefix);
        const tc = new TwitchChannel(req.params.showId, chapterUrlPrefix, FASTIFY_STATIC);
        const xmlFeed = await tc.generateFeed();
        reply.send(xmlFeed);            
    } catch (err) {
        console.warn(err);
        reply.code(404).type('text/html').send(`Podcast ${req.params.showId} not found (${err}).`);
    }
});

fastify.get<{Params : TwitchParamType}>('/twitch/chapters/:showId/:episodeId.m4a', async (req, reply) => {
    try {
        const { showId, episodeId } = req.params;
        const defaultPort = req.protocol === 'https' ? 443 : 80;
        const port = req.port || defaultPort;
        const portSuffix = (port === 80 && req.protocol === 'http') || (port === 443 && req.protocol === 'https') ? '' : `:${port}`;
        console.info(`[REQUEST] ${req.method} ${req.protocol}://${req.hostname}${portSuffix}${req.url}`);
        const chapterUrlPrefix = process.env.EPISODE_PREFIX || `${req.protocol}://${req.hostname}${portSuffix}`;
        
        // Log del intento de descarga con información de caché
        await logChapterDownloadAttempt('twitch', showId, episodeId);
        
        const tc = new TwitchChannel(showId, chapterUrlPrefix, FASTIFY_STATIC);
        const fileName = tc.getFileNameForEpisode(FASTIFY_STATIC, episodeId);
        console.info("File name", fileName);
        
        if (!fileName) {
            console.info(`Episode ${episodeId} not ready yet, triggering download`);
            return reply.code(503).type('text/html').send(`Episode ${episodeId} is being downloaded. Please try again in a few minutes.`);
        }
        
        const stat = fs.statSync(fileName);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;
            const stream = fs.createReadStream(fileName, { start, end });
            
            reply
                .code(206)
                .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
                .header('Accept-Ranges', 'bytes')
                .header('Content-Length', chunkSize)
                .header('Content-Type', 'audio/mp4');
            
            return reply.send(stream);
        } else {
            reply
                .header('Content-Type', 'audio/mp4')
                .header('Content-Length', fileSize)
                .header('Accept-Ranges', 'bytes');
            
            const stream = fs.createReadStream(fileName);
            return reply.send(stream);
        }
    } catch (err) {
        console.warn(err);
        reply.code(404).type('text/html').send(`Error downloading ${req.params.episodeId} of ${req.params.episodeId} (${err}).`);
    }
});


interface IvooxParamType {
    showId : string;
}

fastify.get<{Params : IvooxParamType}>('/ivoox/:showId', async (req, reply) => {
    try {    
        const defaultPort = req.protocol === 'https' ? 443 : 80;
        const port = req.port || defaultPort;
        const portSuffix = (port === 80 && req.protocol === 'http') || (port === 443 && req.protocol === 'https') ? '' : `:${port}`;
        const chapterUrlPrefix = process.env.EPISODE_PREFIX || `${req.protocol}://${req.hostname}${portSuffix}`;
        const channelName = req.params.showId;
        const ic = new IVooxChannel(channelName, chapterUrlPrefix, FASTIFY_STATIC);
        const xmlFeed = await ic.generateFeed();
        if (xmlFeed === undefined) {
            reply.code(404).type('text/html').send(`Podcast ${channelName} not found.`);
        } else {
            reply.send(xmlFeed);    
        }
    } catch (err) {
        console.warn(err);
        reply.code(500).type('text/html').send(`[ERROR] ${err}.`);
    }
});


try {
    await fastify.listen({ port: FASTIFY_PORT, host: '0.0.0.0'});
    console.log(`Server started at port ${FASTIFY_PORT}.`);
} catch (err) {
    console.error(err);
    process.exit(1);
}

