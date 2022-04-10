import { fastify } from 'fastify';

import { IVoox } from './IVoox.js';
import { Params } from './Params';

import { TwitchChannel } from './TwitchChannel.js';


await TwitchChannel.ensureTwitchDl();

async function generateFeed(programName: string) : Promise<string> {
    const programUrl = await IVoox.search(programName);

    if (programUrl === undefined) {
        throw new Error(`URL not found for the program ${programUrl}.`);
    }
    const ivoox = new IVoox(programUrl);
    await ivoox.fetch();
    const xmlFeed = ivoox.generateFeed();    
    return xmlFeed;
}

const app = fastify();

app.get('/', async (req, reply) => {
    const params = req.query as Params;
    try {    
        const xmlFeed = await generateFeed(params.podcast);
        reply.send(xmlFeed);    
    } catch (e) {
        console.warn(e);
        reply.code(404).type('text/html').send(`Podcast ${params.podcast} not found (${e}).`);
    }
});

interface HttpRequest {
    params : {
        showId : string;
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

app.get('/ivoox/:showId', async (req, reply) => {
    const request = req as HttpRequest;
    try {    
        const xmlFeed = await generateFeed(request.params.showId);
        reply.send(xmlFeed);    
    } catch (err) {
        console.warn(err);
        reply.code(404).type('text/html').send(`Podcast ${request.params.showId} not found (${err}).`);
    }
});

app.listen(3000, '0.0.0.0', function (err, address) {
    console.log(`Server started at port 3000.`);
});
