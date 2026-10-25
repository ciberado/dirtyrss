/**
 * LOG_LEVEL=debug activa los logs por request ([MEMORY]) y por video ([VIDEO]).
 * Cualquier otro valor (por defecto 'info') los desactiva.
 */
export const DEBUG_ENABLED = (process.env.LOG_LEVEL ?? 'info').toLowerCase() === 'debug';
