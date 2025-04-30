
import fs from 'fs';
import path from 'path';
import fse from 'fs-extra';

import { fastify, FastifyReply } from 'fastify';
import { default as fastifyStatic } from 'fastify-static';
import { IVooxChannel } from './IVooxChannel.js';

import { TwitchChannel } from './TwitchChannel.js';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

const FASTIFY_PORT = process.env.PORT || 3000;

const FASTIFY_STATIC = '/tmp/public';
const ASSETS_DIRECTORY = `${path.resolve('.')}/assets/`;

fse.copySync(ASSETS_DIRECTORY, FASTIFY_STATIC);

const app = fastify();

if (fs.existsSync(FASTIFY_STATIC) === false) {
    fs.mkdirSync(FASTIFY_STATIC, { recursive : true});
}
app.register(fastifyStatic, {
    root : FASTIFY_STATIC,
    acceptRanges : true
});

interface HttpRequest {
    params : {
        showId : string;
        episodeId: string;
    }
    query : {
        podcast : string;
    }
}

app.get('/twitch/:showId', async (req, reply) => {
    const request = req as HttpRequest;
    try {
        const chapterUrlPrefix = process.env.EPISODE_PREFIX || `${req.protocol}://${req.hostname}`;
        const tc = new TwitchChannel(request.params.showId, chapterUrlPrefix);
        const xmlFeed = await tc.generateFeed();
        reply.send(xmlFeed);            
    } catch (err) {
        console.warn(err);
        reply.code(404).type('text/html').send(`Podcast ${request.params.showId} not found (${err}).`);
    }
});

app.get('/twitch/:showId/:episodeId', async (req, reply) => {
    const request = req as HttpRequest;

    try {
        const chapterUrlPrefix = process.env.EPISODE_PREFIX || `${req.protocol}://${req.hostname}`;
        const tc = new TwitchChannel(request.params.showId, chapterUrlPrefix);
        const fileName = tc.getFileNameForEpisode(FASTIFY_STATIC, request.params.episodeId);
        const url = fileName ? fileName.substring(FASTIFY_STATIC.length) : 'downloading.mp3';
        reply.download(url);    
    } catch (err) {
        console.warn(err);
        reply.code(404).type('text/html').send(`Error downloading ${request.params.episodeId} of ${request.params.episodeId} (${err}).`);
    }
});


async function processIVooxRequest(request : HttpRequest, reply : FastifyReply) {
    try {    
        const channelName = request.query.podcast || request.params.showId;
        const ic = new IVooxChannel(channelName);
        const xmlFeed = await ic.generateFeed();
        if (xmlFeed === undefined) {
            reply.code(404).type('text/html').send(`Podcast ${request.query.podcast} not found.`);
        } else {
            reply.send(xmlFeed);    
        }
    } catch (err) {
        console.warn(err);
        reply.code(500).type('text/html').send(`[ERROR] ${err}.`);
    }
}

app.get('/', async (req, reply) => {
    await processIVooxRequest( req as HttpRequest, reply);
});


app.get('/ivoox/:showId', async (req, reply) => {
    await processIVooxRequest( req as HttpRequest, reply);
});

app.listen(FASTIFY_PORT, '0.0.0.0', function (err, address) {
    console.log(`Server started at port ${FASTIFY_PORT}.`);
});
//# sourceMappingURL=index.js.map