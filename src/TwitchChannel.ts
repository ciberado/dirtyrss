import { default as path } from 'path';
import commandExists from 'command-exists';
import { downloadRelease } from '@terascope/fetch-github-release';
import {PythonShell} from 'python-shell';

export class TwitchChannel {

    static twitchDlPath : string;

    static async ensureTwitchDl() : Promise<string> {
        try {
            console.debug(`Checking for Python3.`);
            const python3 = await commandExists('python3');
            console.info(`Python3 detected! ${python3}`);
            const twitchdl : string[] = await downloadRelease(
                'ihabunek', 'twitch-dl', '/tmp', 
                (r: any) => true,
                (a: any) => a.name.includes('pyz'),
                true, false);
            TwitchChannel.twitchDlPath = twitchdl[0];
            console.info(`TwitchDL downloaded at ${TwitchChannel.twitchDlPath}.`);
            return TwitchChannel.twitchDlPath;
        } catch (error) {
            console.error(`Python 3 not detected (${error}).`);
            process.exit(1);
        }

    }

    constructor(channelName: string) {

    }

    public async fetchChannelData() : Promise<undefined>{
        return new Promise((resolve, reject) => {
            const options = {
                mode: undefined,
                pythonPath: '/usr/bin/python3',
                pythonOptions: [], 
                scriptPath: path.dirname(TwitchChannel.twitchDlPath),
                args: ['--version']
              };
        
            console.log(`wop`);
            PythonShell.run(path.basename(TwitchChannel.twitchDlPath), options, function (err) {
                if (err) reject(err);
                console.log('finished');
                resolve(undefined);
            });
    
        });
    }

    public generateFed(): string {
        return '';
    }

}
