import fs from 'fs';
import path from 'path';
import { YoutubeChannel } from '../channels/YoutubeChannel.js';
import { YtDlpQueue } from './YtDlpQueue.js';
import { default as got } from 'got';

interface AudioStreamResult {
    type: 'file';
    filePath: string;
}

export class YoutubeAudioDownloader {
    // Lock para evitar descargas concurrentes del mismo video
    static downloadingVideos: { [key: string]: boolean } = {};
    
    /**
     * Verifica si un video ya está descargado
     * 
     * @param videoId - ID del video de YouTube
     * @param outputDir - Directorio donde se guardan los archivos
     * @returns Ruta del archivo si existe, null si no
     */
    static getFileNameForVideo(outputDir: string, videoId: string): string | null {
        const outputPath = path.join(outputDir, `${videoId}.m4a`);
        
        if (fs.existsSync(outputPath)) {
            return outputPath;
        }
        
        return null;
    }
    
    /**
     * Descarga y convierte audio en background
     * 
     * @param videoId - ID del video de YouTube
     * @param outputDir - Directorio donde guardar archivos convertidos
     */
    static async downloadInBackground(videoId: string, outputDir: string): Promise<void> {
        // Evitar descargas concurrentes del mismo video
        if (this.downloadingVideos[videoId]) {
            console.log(`[YOUTUBE AUDIO] Download already in progress for ${videoId}`);
            return;
        }
        
        const outputPath = path.join(outputDir, `${videoId}.m4a`);
        const tempPath = path.join(outputDir, `${videoId}.tmp.m4a`);
        
        // Verificar si ya está siendo descargado
        if (fs.existsSync(tempPath)) {
            console.log(`[YOUTUBE AUDIO] Video ${videoId} is already being downloaded (${tempPath} exists)`);
            return;
        }
        
        this.downloadingVideos[videoId] = true;
        
        try {
            // Crear directorio si no existe
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            
            // Verificar si ya existe el archivo final
            if (fs.existsSync(outputPath)) {
                console.log(`[YOUTUBE AUDIO] File already exists for ${videoId}`);
                return;
            }
            
            // Descargar m4a directamente (DASH) sin conversión
            const startTime = Date.now();
            console.log(`[YOUTUBE AUDIO] Starting background download for ${videoId}...`);
            console.log(`[YOUTUBE AUDIO] Command: ${YoutubeChannel.ytDlpPath} -f "bestaudio[ext=m4a]" -o "${tempPath}" "https://www.youtube.com/watch?v=${videoId}"`);
            
            // Descarga solo m4a DASH (sin conversión con ffmpeg, mucho más rápido)
            // Usando la cola global para evitar sobrecarga
            const stdout = await YtDlpQueue.exec(
                `${YoutubeChannel.ytDlpPath} -f "bestaudio[ext=m4a]" -o "${tempPath}" "https://www.youtube.com/watch?v=${videoId}"`,
                100 * 1024 * 1024
            );
            
            /* CODIGO DE CONVERSION COMENTADO (por si hay que volver atrás)
            // Nota: yt-dlp con -x y --audio-format va a:
            // 1. Descargar audio (puede ser webm)
            // 2. Convertir a m4a con ffmpeg (LENTO)
            // 3. El nombre final será el que especifiquemos
            const { stdout, stderr } = await execAsync(
                `${YoutubeChannel.ytDlpPath} -f "bestaudio" -x --audio-format m4a --audio-quality 0 -o "${tempPath.replace('.m4a', '')}" "https://www.youtube.com/watch?v=${videoId}"`,
                { maxBuffer: 100 * 1024 * 1024 }
            );
            */
            
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`[YOUTUBE AUDIO] Download completed in ${elapsed}s at ${tempPath}`);
            if (stdout) console.log(`[YOUTUBE AUDIO] stdout: ${stdout.substring(0, 500)}`);
            
            // Mover archivo temporal al nombre final (operación atómica)
            fs.renameSync(tempPath, outputPath);
            console.log(`[YOUTUBE AUDIO] Video saved at ${outputPath}`);
            
        } catch (error) {
            console.error(`[YOUTUBE AUDIO] Error downloading ${videoId}:`, error);
            // Limpiar archivo temporal si existe
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } finally {
            delete this.downloadingVideos[videoId];
        }
    }
    
    /**
     * Obtiene el tamaño del archivo de audio
     * Si el archivo existe, devuelve su tamaño
     * Si no existe, devuelve 0 (se descargará bajo demanda)
     */
    static async getAudioSize(videoId: string, outputDir: string): Promise<number> {
        try {
            const outputPath = path.join(outputDir, `${videoId}.m4a`);
            
            // Si el archivo ya existe, devolver su tamaño
            if (fs.existsSync(outputPath)) {
                const stat = fs.statSync(outputPath);
                return stat.size;
            }
            
            // Si no existe, devolver 0
            // El archivo se descargará cuando el usuario lo reproduzca
            return 0;
            
        } catch (error) {
            console.error(`[YOUTUBE AUDIO] Error getting audio size for ${videoId}:`, error);
            return 0;
        }
    }
}
