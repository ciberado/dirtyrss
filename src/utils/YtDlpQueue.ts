import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface QueueItem {
    command: string;
    resolve: (value: string) => void;
    reject: (reason: any) => void;
    context?: string; // Información contextual para logging
}

/**
 * Cola global para limitar la concurrencia de comandos yt-dlp.
 * 
 * Esto evita que múltiples peticiones HTTP concurrentes lancen
 * decenas de procesos yt-dlp simultáneamente, consumiendo recursos.
 */
export class YtDlpQueue {
    private static readonly MAX_CONCURRENT = parseInt(process.env.YTDLP_MAX_CONCURRENT || '10');
    private static queue: QueueItem[] = [];
    private static running = 0;

    /**
     * Ejecuta un comando yt-dlp respetando el límite de concurrencia global.
     * 
     * @param command - Comando completo a ejecutar
     * @param context - Información contextual para logging (ej: "channel:@nombre, video:ID")
     * @param maxBuffer - Tamaño máximo del buffer (default: 50MB)
     * @returns Promise con el stdout del comando
     */
    static async exec(command: string, context?: string, maxBuffer: number = 50 * 1024 * 1024): Promise<string> {
        return new Promise((resolve, reject) => {
            this.queue.push({ command, resolve, reject, context });
            this.processQueue();
        });
    }

    private static async processQueue(): Promise<void> {
        // Si ya estamos al límite de concurrencia o no hay tareas, salir
        if (this.running >= this.MAX_CONCURRENT || this.queue.length === 0) {
            return;
        }

        // Tomar la siguiente tarea de la cola
        const item = this.queue.shift();
        if (!item) return;

        this.running++;
        
        const startTime = Date.now();
        const contextStr = item.context || 'unknown';

        try {
            const { stdout } = await execAsync(item.command, { maxBuffer: 50 * 1024 * 1024 });
            const duration = Date.now() - startTime;
            console.log(`[yt-dlp] ✓ ${contextStr} (${duration}ms) [${this.running - 1}/${this.MAX_CONCURRENT} active]`);
            item.resolve(stdout);
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            // Extraer el mensaje de error más relevante
            let errorMsg = 'unknown error';
            if (error.stderr) {
                const stderr = error.stderr.toString();
                // Buscar la línea de ERROR
                const errorLine = stderr.split('\n').find((line: string) => line.includes('ERROR:'));
                if (errorLine) {
                    errorMsg = errorLine.replace('ERROR: [youtube]', '').replace('ERROR:', '').trim();
                } else {
                    errorMsg = stderr.slice(0, 100);
                }
            } else if (error.message) {
                errorMsg = error.message.slice(0, 100);
            }
            
            console.error(`[yt-dlp] ✗ ${contextStr} (${duration}ms): ${errorMsg}`);
            item.reject(error);
        } finally {
            this.running--;
            // Procesar siguiente tarea de la cola
            this.processQueue();
        }
    }

    /**
     * Devuelve estadísticas actuales de la cola
     */
    static getStats(): { running: number; queued: number; maxConcurrent: number } {
        return {
            running: this.running,
            queued: this.queue.length,
            maxConcurrent: this.MAX_CONCURRENT
        };
    }
}
