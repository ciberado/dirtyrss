import commandExists from 'command-exists';
import { downloadRelease } from '@terascope/fetch-github-release';

export class TwitchChannel {

    static async ensureDependencies() {
        try {
            console.debug(`Checking for Python3.`);
            await commandExists('python3');
            console.info(`Python3 detected!`);
            const twitchdl = await downloadRelease('ihabunek', 'twitch-dl', '/tmp', 
                (r: any) => true,
                (a: any) => a.name.includes('pyz'),
                true, false);
            console.dir(twitchdl)
        } catch (error) {
            console.error(`Python 3 not detected (${error}).`);
            process.exit(1);
        }

    }

    constructor(channelName: string) {

    }

    public async fetchChannelData() {
    }

    public generateFed(): string {
        return '';
    }

}
