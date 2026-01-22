import fs from 'fs';
import commandExists from 'command-exists';
import { downloadRelease } from '@terascope/fetch-github-release';

export class ExternalTools {
    private static ytDlpPath: string | null = null;
    private static twitchDlPath: string | null = null;

    /**
     * Verifica dependencias del sistema
     */
    private static async checkSystemDependencies(): Promise<void> {
        console.debug(`Checking for Python3.`);
        const python3Exists = commandExists.sync('python3');
        if (!python3Exists) {
            throw new Error('Python3 not found in PATH. Please install it from https://www.python.org/downloads.');
        }
        console.info(`Python3 detected!`);

        console.debug(`Checking for ffmpeg.`);
        const ffmpegExists = commandExists.sync('ffmpeg');
        if (!ffmpegExists) {
            throw new Error('ffmpeg not found in PATH. Please install it from https://www.ffmpeg.org/download.html.');
        }
        console.info(`ffmpeg detected!`);
    }

    /**
     * Descarga yt-dlp si no está ya descargado
     */
    static async getYtDlpPath(): Promise<string> {
        if (this.ytDlpPath) {
            return this.ytDlpPath;
        }

        await this.checkSystemDependencies();

        console.info('Downloading yt-dlp...');
        const ytDlp: string[] = await downloadRelease(
            'yt-dlp', 'yt-dlp', '/tmp',
            (r: any) => true,
            (a: any) => a.name === 'yt-dlp',
            true, false
        );
        this.ytDlpPath = ytDlp[0];
        
        // Dar permisos de ejecución
        fs.chmodSync(this.ytDlpPath, 0o755);
        
        console.info(`yt-dlp downloaded at ${this.ytDlpPath}`);
        return this.ytDlpPath;
    }

    /**
     * Descarga twitch-dl si no está ya descargado
     */
    static async getTwitchDlPath(): Promise<string> {
        if (this.twitchDlPath) {
            return this.twitchDlPath;
        }

        await this.checkSystemDependencies();

        console.info('Downloading twitch-dl...');
        const twitchDl: string[] = await downloadRelease(
            'ihabunek', 'twitch-dl', '/tmp',
            (r: any) => true,
            (a: any) => a.name.includes('pyz'),
            true, false
        );
        this.twitchDlPath = twitchDl[0];
        
        console.info(`twitch-dl downloaded at ${this.twitchDlPath}`);
        return this.twitchDlPath;
    }
}
