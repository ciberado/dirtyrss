import fs from 'fs';
import commandExists from 'command-exists';
import { downloadRelease } from '@terascope/fetch-github-release';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
     * Descarga y actualiza yt-dlp a la versión nightly
     */
    static async getYtDlpPath(): Promise<string> {
        if (this.ytDlpPath) {
            return this.ytDlpPath;
        }

        await this.checkSystemDependencies();

        const ytDlpPath = '/tmp/yt-dlp';
        
        // Verificar si ya existe
        const exists = fs.existsSync(ytDlpPath);
        
        if (exists) {
            console.info('yt-dlp found, updating to nightly...');
            try {
                // Intentar actualizar a nightly
                await execAsync(`${ytDlpPath} --update-to nightly`);
                console.info('yt-dlp updated to nightly version');
            } catch (error) {
                console.warn('Could not update yt-dlp, will download fresh copy:', error);
                fs.unlinkSync(ytDlpPath);
            }
        }
        
        // Si no existe o falló la actualización, descargar
        if (!fs.existsSync(ytDlpPath)) {
            console.info('Downloading yt-dlp nightly...');
            
            // Descargar versión nightly directamente
            try {
                await execAsync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/download/nightly/yt-dlp -o ${ytDlpPath}`);
                fs.chmodSync(ytDlpPath, 0o755);
                console.info('yt-dlp nightly downloaded successfully');
            } catch (error) {
                console.error('Failed to download nightly, falling back to stable release');
                // Fallback a versión stable
                const ytDlp: string[] = await downloadRelease(
                    'yt-dlp', 'yt-dlp', '/tmp',
                    (r: any) => true,
                    (a: any) => a.name === 'yt-dlp',
                    true, false
                );
                this.ytDlpPath = ytDlp[0];
                fs.chmodSync(this.ytDlpPath, 0o755);
                console.info(`yt-dlp stable downloaded at ${this.ytDlpPath}`);
                return this.ytDlpPath;
            }
        }
        
        this.ytDlpPath = ytDlpPath;
        
        // Obtener versión para logging
        try {
            const { stdout } = await execAsync(`${ytDlpPath} --version`);
            console.info(`yt-dlp version: ${stdout.trim()}`);
        } catch (error) {
            console.warn('Could not get yt-dlp version');
        }
        
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
