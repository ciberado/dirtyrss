import fs from 'fs';
import path from 'path';
import fse from 'fs-extra';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { IVooxChannel } from './channels/IVooxChannel.js';
import { TwitchChannel } from './channels/TwitchChannel.js';
import { LavanguardiaChannel } from './channels/LavanguardiaChannel.js';

const FASTIFY_PORT = parseInt(process.env.PORT!) || 3000;

const FASTIFY_STATIC = '/tmp/public';
const ASSETS_DIRECTORY = `${path.resolve('.')}/assets/`;

fse.copySync(ASSETS_DIRECTORY, FASTIFY_STATIC);

const fastify = Fastify({
    trustProxy: true
});

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

interface LavanguardiaParamType {
    author : string;
}


fastify.get<{ Params: LavanguardiaParamType }>('/lavanguardia/:author', async (req, reply) => {
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

fastify.get<{Params : TwitchParamType}>('/twitch/:showId/:episodeId.m4a', async (req, reply) => {
    try {
        const defaultPort = req.protocol === 'https' ? 443 : 80;
        const port = req.port || defaultPort;
        const portSuffix = (port === 80 && req.protocol === 'http') || (port === 443 && req.protocol === 'https') ? '' : `:${port}`;
        console.info(`[REQUEST] ${req.method} ${req.protocol}://${req.hostname}${portSuffix}${req.url}`);
        const chapterUrlPrefix = process.env.EPISODE_PREFIX || `${req.protocol}://${req.hostname}${portSuffix}`;
        const tc = new TwitchChannel(req.params.showId, chapterUrlPrefix, FASTIFY_STATIC);
        const fileName = tc.getFileNameForEpisode(FASTIFY_STATIC, req.params.episodeId);
        console.info("File name", fileName);
        
        if (!fileName) {
            console.info(`Episode ${req.params.episodeId} not ready yet, triggering download`);
            return reply.code(503).type('text/html').send(`Episode ${req.params.episodeId} is being downloaded. Please try again in a few minutes.`);
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
        const channelName = req.params.showId;
        const ic = new IVooxChannel(channelName);
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

