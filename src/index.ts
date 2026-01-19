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

if (fs.existsSync(FASTIFY_STATIC) === false) {
    fs.mkdirSync(FASTIFY_STATIC, { recursive : true});
}
fastify.register(fastifyStatic, {
    root : FASTIFY_STATIC,
    acceptRanges : true
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
        const tc = new TwitchChannel(req.params.showId, chapterUrlPrefix);
        const xmlFeed = await tc.generateFeed();
        reply.send(xmlFeed);            
    } catch (err) {
        console.warn(err);
        reply.code(404).type('text/html').send(`Podcast ${req.params.showId} not found (${err}).`);
    }
});

fastify.get<{Params : TwitchParamType}>('/twitch/:showId/:episodeId.mp3', async (req, reply) => {
    try {
        const defaultPort = req.protocol === 'https' ? 443 : 80;
        const port = req.port || defaultPort;
        const portSuffix = (port === 80 && req.protocol === 'http') || (port === 443 && req.protocol === 'https') ? '' : `:${port}`;
        console.info(`[REQUEST] ${req.method} ${req.protocol}://${req.hostname}${portSuffix}${req.url}`);
        const chapterUrlPrefix = process.env.EPISODE_PREFIX || `${req.protocol}://${req.hostname}${portSuffix}`;
        const tc = new TwitchChannel(req.params.showId, chapterUrlPrefix);
        const fileName = tc.getFileNameForEpisode(FASTIFY_STATIC, req.params.episodeId);
        console.info("File name", fileName);
        
        if (!fileName) {
            console.info(`Episode ${req.params.episodeId} not ready yet, triggering download`);
            return reply.code(503).type('text/html').send(`Episode ${req.params.episodeId} is being downloaded. Please try again in a few minutes.`);
        }
        
        const stat = fs.statSync(fileName);
        const filename = path.basename(fileName);
        console.info("File size from stat:", stat.size);
        
        reply
            .header('Content-Type', 'audio/mpeg')
            .header('Content-Length', stat.size)
            .header('Content-Disposition', `attachment; filename="${req.params.episodeId}.mp3"`);
        
        const stream = fs.createReadStream(fileName);
        return reply.send(stream);
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

