import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface QueueItem {
    command: string;
    resolve: (value: string) => void;
    reject: (reason: any) => void;
}

/**
 * Cola global para limitar la concurrencia de comandos yt-dlp.
 * 
 * Esto evita que múltiples peticiones HTTP concurrentes lancen
 * decenas de procesos yt-dlp simultáneamente, consumiendo recursos.
 */
export class YtDlpQueue {
    private static readonly MAX_CONCURRENT = 3; // Máximo de comandos yt-dlp concurrentes
    private static queue: QueueItem[] = [];
    private static running = 0;

    /**
     * Ejecuta un comando yt-dlp respetando el límite de concurrencia global.
     * 
     * @param command - Comando completo a ejecutar
     * @param maxBuffer - Tamaño máximo del buffer (default: 50MB)
     * @returns Promise con el stdout del comando
     */
    static async exec(command: string, maxBuffer: number = 50 * 1024 * 1024): Promise<string> {
        return new Promise((resolve, reject) => {
            this.queue.push({ command, resolve, reject });
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
        console.log(`[YtDlpQueue] Starting command (${this.running}/${this.MAX_CONCURRENT} active, ${this.queue.length} queued)`);

        try {
            const { stdout } = await execAsync(item.command, { maxBuffer: 50 * 1024 * 1024 });
            const duration = Date.now() - startTime;
            console.log(`[YtDlpQueue] Command completed in ${duration}ms (${this.running - 1}/${this.MAX_CONCURRENT} active, ${this.queue.length} queued)`);
            item.resolve(stdout);
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[YtDlpQueue] Command failed after ${duration}ms:`, error);
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
