import { promises as fsp } from 'fs';

/** Equivalente asíncrono a fs.existsSync (no bloquea el event loop). */
export async function pathExists(p: string): Promise<boolean> {
    try {
        await fsp.access(p);
        return true;
    } catch {
        return false;
    }
}
