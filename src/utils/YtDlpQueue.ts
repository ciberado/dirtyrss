import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

interface QueueItem {
    command: string;
    weight: 'light' | 'heavy';
    label: string;
    resolve: (value: string) => void;
    reject: (reason: any) => void;
    context?: string; // Información contextual para logging
    key?: string; // Clave de coalescing: misma clave = misma promesa
    cleanupPrefix?: string; // Ruta prefijo de los ficheros temporales a borrar antes de reintentar
}

interface RunStats {
    maxIdleMs: number; // Mayor hueco sin salida (stdout/stderr) observado en la ejecución
}

// Límite de bytes acumulados para stdout (metadatos JSON). Evita acumular
// salida enorme en memoria; por encima se trunca.
const STDOUT_MAX = 64 * 1024 * 1024;
// Solo conservamos la cola del stderr (para extraer el mensaje de error).
const STDERR_TAIL = 8 * 1024;

function envInt(name: string, def: number): number {
    const v = parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(v) && v >= 0 ? v : def;
}

// Watchdog: segundos sin ninguna salida antes de considerar el proceso colgado (0 = desactivado)
const STALL_LIGHT_MS = envInt('YTDLP_STALL_LIGHT_S', 45) * 1000;
const STALL_HEAVY_MS = envInt('YTDLP_STALL_HEAVY_S', 60) * 1000;
const STALL_TWITCH_MS = envInt('YTDLP_STALL_TWITCH_S', 180) * 1000;
const MAX_RETRIES = envInt('YTDLP_MAX_RETRIES', 2);
const RETRY_DELAY_MS = 5000;
const WATCHDOG_INTERVAL_MS = 5000;
const KILL_GRACE_MS = 5000;

class StallError extends Error {
    stderr = '';
    constructor(public idleMs: number) {
        super(`process stalled: no output for ${Math.round(idleMs / 1000)}s`);
    }
}

/**
 * Cola global para limitar la concurrencia de comandos yt-dlp.
 *
 * Separa las operaciones en dos pools con límites distintos:
 * - `light`: metadatos (--dump-json, --flat-playlist), rápidos y de baja memoria.
 * - `heavy`: descarga de audio, largas y con alto consumo de CPU/memoria.
 *
 * Usa `spawn` en lugar de `exec` para no bufferizar stdout/stderr en memoria
 * y así acotar el consumo por proceso.
 *
 * Incluye un watchdog por inactividad: si un proceso no escribe nada en
 * stdout/stderr durante el umbral de su pool, se mata todo su grupo de
 * procesos y se relanza (hasta YTDLP_MAX_RETRIES veces). No hay timeout
 * total, así que un trabajo largo con progreso constante nunca se interrumpe.
 */
export class YtDlpQueue {
    private static readonly LIGHT_MAX = parseInt(process.env.YTDLP_MAX_CONCURRENT || '8');
    private static readonly HEAVY_MAX = parseInt(process.env.YTDLP_MAX_CONCURRENT_HEAVY || '2');
    private static readonly LIGHT_MAX_PENDING = parseInt(process.env.YTDLP_MAX_PENDING_LIGHT || '200');
    private static readonly HEAVY_MAX_PENDING = parseInt(process.env.YTDLP_MAX_PENDING_HEAVY || '50');

    private static lightQueue: QueueItem[] = [];
    private static heavyQueue: QueueItem[] = [];
    private static lightRunning = 0;
    private static heavyRunning = 0;
    // Tareas en curso (encoladas o ejecutándose) por clave de coalescing
    private static inFlight = new Map<string, Promise<string>>();

    /**
     * Ejecuta un comando yt-dlp respetando el límite de concurrencia de su pool.
     *
     * Aplica coalescing por `key`: si ya hay una tarea con la misma clave
     * encolada o ejecutándose, devuelve la misma promesa en lugar de lanzar
     * otro proceso. Aplica backpressure: si la cola del pool está llena,
     * rechaza la promesa sin encolar (load shedding).
     *
     * @param command - Comando completo a ejecutar
     * @param context - Información contextual para logging (ej: "channel:@nombre, video:ID")
     * @param weight - `light` para metadatos, `heavy` para descargas de audio
     * @param label - Etiqueta para el log (ej: "yt-dlp", "twitch-dl")
     * @param key - Clave opcional para coalescing (ej: id del video)
     * @param cleanupPrefix - Ruta prefijo de ficheros temporales (.part, .ytdl...) que se borran antes de reintentar tras un cuelgue
     * @returns Promise con el stdout del comando
     */
    static async exec(command: string, context?: string, weight: 'light' | 'heavy' = 'light', label: string = 'yt-dlp', key?: string, cleanupPrefix?: string): Promise<string> {
        if (key && this.inFlight.has(key)) {
            return this.inFlight.get(key)!;
        }

        const pool: 'light' | 'heavy' = weight === 'heavy' ? 'heavy' : 'light';
        const maxPending = pool === 'heavy' ? this.HEAVY_MAX_PENDING : this.LIGHT_MAX_PENDING;
        const pending = pool === 'heavy' ? this.heavyQueue.length : this.lightQueue.length;

        if (pending >= maxPending) {
            return Promise.reject(new Error(`[${label}:${pool}] queue full (${pending} pending). Load shed.`));
        }

        const promise = new Promise<string>((resolve, reject) => {
            const item: QueueItem = { command, weight, label, resolve, reject, context, key, cleanupPrefix };
            if (pool === 'heavy') {
                this.heavyQueue.push(item);
                this.processHeavy();
            } else {
                this.lightQueue.push(item);
                this.processLight();
            }
        });

        if (key) {
            this.inFlight.set(key, promise);
            promise.then(
                () => { if (this.inFlight.get(key) === promise) this.inFlight.delete(key); },
                () => { if (this.inFlight.get(key) === promise) this.inFlight.delete(key); }
            );
        }

        return promise;
    }

    private static stallMsFor(item: QueueItem): number {
        if (item.label === 'twitch-dl') return STALL_TWITCH_MS;
        return item.weight === 'heavy' ? STALL_HEAVY_MS : STALL_LIGHT_MS;
    }

    private static run(item: QueueItem, stats: RunStats): Promise<string> {
        return new Promise((resolve, reject) => {
            // detached: el proceso lidera su propio grupo, para poder matar
            // sh + yt-dlp/python + ffmpeg de una vez con process.kill(-pid).
            const child = spawn(item.command, { shell: true, detached: true });

            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');

            let stdout = '';
            let stdoutTruncated = false;
            let stderrTail = '';

            const stallMs = this.stallMsFor(item);
            let lastActivity = Date.now();
            let stalled = false;
            let stalledIdleMs = 0;
            let killTimer: NodeJS.Timeout | undefined;

            const killGroup = (signal: NodeJS.Signals) => {
                try {
                    if (child.pid) process.kill(-child.pid, signal);
                } catch {
                    // El grupo ya ha terminado
                }
            };

            const touch = () => {
                const now = Date.now();
                stats.maxIdleMs = Math.max(stats.maxIdleMs, now - lastActivity);
                lastActivity = now;
            };

            const watchdog = setInterval(() => {
                const idle = Date.now() - lastActivity;
                stats.maxIdleMs = Math.max(stats.maxIdleMs, idle);
                if (stalled || stallMs === 0 || idle < stallMs) return;
                stalled = true;
                stalledIdleMs = idle;
                killGroup('SIGTERM');
                killTimer = setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS);
            }, WATCHDOG_INTERVAL_MS);

            const stopTimers = () => {
                clearInterval(watchdog);
                if (killTimer) clearTimeout(killTimer);
            };

            child.stdout.on('data', (chunk: string) => {
                touch();
                if (stdoutTruncated) return;
                stdout += chunk;
                if (stdout.length > STDOUT_MAX) {
                    stdout = stdout.slice(0, STDOUT_MAX);
                    stdoutTruncated = true;
                }
            });

            child.stderr.on('data', (chunk: string) => {
                touch();
                stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL);
            });

            child.on('error', (err) => {
                stopTimers();
                reject(err);
            });

            child.on('close', (code) => {
                stopTimers();
                if (stalled) {
                    // Asegurar que no quede ningún proceso del grupo vivo
                    killGroup('SIGKILL');
                    reject(new StallError(stalledIdleMs));
                } else if (code === 0) {
                    resolve(stdout);
                } else {
                    const errorLine = stderrTail.split('\n').find((line) => line.includes('ERROR:'));
                    const message = errorLine || stderrTail.slice(0, 200) || `yt-dlp exited with code ${code}`;
                    const err = new Error(message) as Error & { stderr?: string };
                    err.stderr = stderrTail;
                    reject(err);
                }
            });
        });
    }

    /** Borra los ficheros temporales que empiecen por el prefijo (p. ej. `ID.tmp.m4a.part`). */
    private static async cleanupTemp(prefix?: string): Promise<void> {
        if (!prefix) return;
        try {
            const dir = path.dirname(prefix);
            const base = path.basename(prefix);
            for (const name of await fs.promises.readdir(dir)) {
                if (name.startsWith(base)) {
                    await fs.promises.rm(path.join(dir, name), { force: true });
                }
            }
        } catch {
            // Directorio inexistente u otro error: nada que limpiar
        }
    }

    private static processLight(): void {
        if (this.lightRunning >= this.LIGHT_MAX || this.lightQueue.length === 0) {
            return;
        }

        const item = this.lightQueue.shift();
        if (!item) return;

        this.lightRunning++;
        this.execute(item, 'light').finally(() => {
            this.lightRunning--;
            this.processLight();
        });
    }

    private static processHeavy(): void {
        if (this.heavyRunning >= this.HEAVY_MAX || this.heavyQueue.length === 0) {
            return;
        }

        const item = this.heavyQueue.shift();
        if (!item) return;

        this.heavyRunning++;
        this.execute(item, 'heavy').finally(() => {
            this.heavyRunning--;
            this.processHeavy();
        });
    }

    private static async execute(item: QueueItem, pool: 'light' | 'heavy'): Promise<void> {
        const startTime = Date.now();
        const contextStr = item.context || 'unknown';

        for (let attempt = 0; ; attempt++) {
            const stats: RunStats = { maxIdleMs: 0 };

            try {
                const stdout = await this.run(item, stats);
                const duration = Date.now() - startTime;
                const retryInfo = attempt > 0 ? ` after ${attempt} restart(s)` : '';
                console.log(`[${item.label}:${pool}] ✓ ${contextStr} (${duration}ms) [${this.activeFor(pool)}/${this.maxFor(pool)} active] max idle ${(stats.maxIdleMs / 1000).toFixed(1)}s${retryInfo}`);
                item.resolve(stdout);
                return;
            } catch (error: any) {
                if (error instanceof StallError) {
                    await this.cleanupTemp(item.cleanupPrefix);
                    if (attempt < MAX_RETRIES) {
                        console.warn(`[${item.label}:${pool}] ⟲ stalled ${Math.round(error.idleMs / 1000)}s, restart ${attempt + 1}/${MAX_RETRIES} ${contextStr}`);
                        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
                        continue;
                    }
                }

                const duration = Date.now() - startTime;

                let errorMsg = 'unknown error';
                if (error.stderr) {
                    const stderr = error.stderr.toString();
                    const errorLine = stderr.split('\n').find((line: string) => line.includes('ERROR:'));
                    if (errorLine) {
                        errorMsg = errorLine.replace('ERROR: [youtube]', '').replace('ERROR:', '').trim();
                    } else {
                        errorMsg = stderr.slice(0, 100);
                    }
                } else if (error.message) {
                    errorMsg = error.message.slice(0, 100);
                }

                console.error(`[${item.label}:${pool}] ✗ ${contextStr} (${duration}ms, max idle ${(stats.maxIdleMs / 1000).toFixed(1)}s): ${errorMsg}`);
                item.reject(error);
                return;
            }
        }
    }

    private static activeFor(pool: 'light' | 'heavy'): number {
        return pool === 'heavy' ? this.heavyRunning : this.lightRunning;
    }

    private static maxFor(pool: 'light' | 'heavy'): number {
        return pool === 'heavy' ? this.HEAVY_MAX : this.LIGHT_MAX;
    }

    /**
     * Devuelve estadísticas actuales de la cola
     */
    static getStats(): {
        light: { running: number; queued: number; max: number; maxPending: number };
        heavy: { running: number; queued: number; max: number; maxPending: number };
        inFlight: number;
    } {
        return {
            light: { running: this.lightRunning, queued: this.lightQueue.length, max: this.LIGHT_MAX, maxPending: this.LIGHT_MAX_PENDING },
            heavy: { running: this.heavyRunning, queued: this.heavyQueue.length, max: this.HEAVY_MAX, maxPending: this.HEAVY_MAX_PENDING },
            inFlight: this.inFlight.size
        };
    }
}
