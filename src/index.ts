import fs from 'fs';
import path from 'path';
import fse from 'fs-extra';

import { fastify, FastifyRequest, FastifyReply } from 'fastify';
import { default as fastifyStatic } from 'fastify-static';
import { IVooxChannel } from './IVooxChannel.js';

import { TwitchChannel } from './TwitchChannel.js';


await TwitchChannel.initializeWitchSubsystem();


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
        const tc = new TwitchChannel(request.params.showId);
        const xmlFeed = await tc.generateFeed();
        reply.send(xmlFeed);            
    } catch (err) {
        console.warn(err);
        reply.code(404).type('text/html').send(`Podcast ${request.params.showId} not found (${err}).`);
    }
});

app.get('/twitch/:showId/:episodeId', async (req, reply) => {
    const request = req as HttpRequest;

    const tc = new TwitchChannel(request.params.showId);
    const fileName = tc.getFileNameForEpisode(FASTIFY_STATIC, request.params.episodeId);
    const url = fileName ? fileName.substring(FASTIFY_STATIC.length) : 'downloading.aac';
    reply.download(url);
});


async function processIVooxRequest(request : HttpRequest, reply : FastifyReply) {
    try {    
        const channelName = request.query.podcast || request.params.showId;
        const ic = new IVooxChannel(channelName);
        const xmlFeed = await ic.generateFeed();
        if (xmlFeed === null) {
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

app.listen(3000, '0.0.0.0', function (err, address) {
    console.log(`Server started at port 3000.`);
});
