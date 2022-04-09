import { default as fastify } from 'fastify';

import { IVoox } from './IVoox.js';
import { Params } from './Params';

import { TwitchChannel } from './TwitchChannel.js';


await TwitchChannel.ensureDependencies();
if (0===0) process.exit(0);

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
app.listen(3000, '0.0.0.0', function (err, address) {
    console.log(`Server started.`);
});
