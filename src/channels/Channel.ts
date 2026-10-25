import { Podcast } from 'podcast';
import { Chapter } from '../models/Chapter.js';
import { performance } from 'perf_hooks';
import { IChapterCache } from '../cache/IChapterCache.js';
import { InMemoryChapterCache } from '../cache/InMemoryChapterCache.js';
import { RedisChapterCache } from '../cache/RedisChapterCache.js';
import { ImageProcessor } from '../utils/ImageProcessor.js';
import * as path from 'path';
import { pathExists } from '../utils/FsUtils.js';

export abstract class Channel {
    
    public static chapterCache: IChapterCache;
    protected static cacheInitialized: boolean = false;
    private static cacheInitPromise?: Promise<void>;

    // Caché del XML del feed (TTL corto, configurable; 0 = desactivada)
    private static readonly FEED_CACHE_TTL_MS: number =
        Math.max(0, parseInt(process.env.FEED_CACHE_TTL_SECONDS ?? '300') || 0) * 1000;
    private static readonly FEED_CACHE_MAX_ENTRIES: number = 100;
    private static feedCache = new Map<string, { xml: string; expires: number }>();
    private static feedInFlight = new Map<string, Promise<string | undefined>>();

    // Las subclases lo ponen a false cuando el feed es parcial/vacío para no cachearlo
    protected feedCacheable: boolean = true;

    protected channelName: string;
    protected description?: string;
    protected feedUrl?: string;
    protected siteUrl?: string;
    protected imageUrl?: string;
    protected author?: string;
    protected ttlInMinutes?: number;
    protected link?: string;

    constructor(channelName : string) {
        this.channelName = channelName;
    }

    protected static initializeCache(): Promise<void> {
        if (Channel.cacheInitialized) {
            return Promise.resolve();
        }

        // Todas las peticiones simultáneas esperan a la misma inicialización
        if (!Channel.cacheInitPromise) {
            Channel.cacheInitPromise = (async () => {
                const cacheType = process.env.CACHE_TYPE || 'memory';

                if (cacheType === 'redis') {
                    console.info('Initializing Redis cache...');
                    Channel.chapterCache = await RedisChapterCache.create();
                } else {
                    console.info('Initializing in-memory cache...');
                    Channel.chapterCache = new InMemoryChapterCache();
                }

                Channel.cacheInitialized = true;
            })().catch((err) => {
                // Permite reintentar en la siguiente petición si falla (p. ej. Redis caído)
                Channel.cacheInitPromise = undefined;
                throw err;
            });
        }

        return Channel.cacheInitPromise;
    }

    protected abstract fetchChannelInformation() : Promise<void>;
    
    protected abstract fetchEpisodeList() : Promise<Chapter[]>;

    protected abstract fetchChapterData(identifier: string): Promise<Chapter>;
    
    /**
     * Retorna la ruta del logo si existe, undefined si no
     */
    protected getLogoPath(): string | undefined {
        return undefined;
    }
    
    /**
     * Retorna el color de fondo del badge
     */
    protected getBadgeColor(): string | undefined {
        return undefined;
    }
    
    /**
     * Aplica watermark al imageUrl si existe logo configurado
     */
    protected async applyChannelWatermark(staticFilesPath: string, chapterUrlPrefix: string): Promise<void> {
        const logoPath = this.getLogoPath();
        const backgroundColor = this.getBadgeColor();
        
        if (!logoPath || !backgroundColor) {
            return;
        }
        
        const fullLogoPath = `${path.resolve('.')}/${logoPath}`;
        if (!(await pathExists(fullLogoPath))) {
            console.warn(`Logo not found at ${fullLogoPath}, skipping watermark`);
            return;
        }
        
        const imageProcessor = new ImageProcessor(staticFilesPath, chapterUrlPrefix);
        this.imageUrl = await imageProcessor.processChannelImage(
            this.imageUrl,
            this.constructor.name.replace('Channel', '').toLowerCase(),
            this.channelName,
            {
                logoPath: fullLogoPath,
                backgroundColor: backgroundColor,
                badgeShape: 'blob',
                badgeSize: 0.155
            },
            24
        );
    }

    /**
     * Clave de la caché del feed XML. Las subclases deben añadir todo lo que
     * cambie el XML generado (p. ej. el prefijo de URL de los capítulos).
     */
    protected getFeedCacheKey(): string {
        return `${this.constructor.name}:${this.channelName}`;
    }

    private static storeFeed(key: string, xml: string): void {
        const now = Date.now();
        if (Channel.feedCache.size >= Channel.FEED_CACHE_MAX_ENTRIES) {
            for (const [k, v] of Channel.feedCache) {
                if (v.expires <= now) Channel.feedCache.delete(k);
            }
            // Si sigue lleno, descartar la entrada más antigua (orden de inserción)
            if (Channel.feedCache.size >= Channel.FEED_CACHE_MAX_ENTRIES) {
                const oldest = Channel.feedCache.keys().next().value;
                if (oldest !== undefined) Channel.feedCache.delete(oldest);
            }
        }
        Channel.feedCache.set(key, { xml, expires: now + Channel.FEED_CACHE_TTL_MS });
    }

    /**
     * Devuelve el feed XML con caché de corta duración y deduplicación de
     * peticiones simultáneas (varias peticiones iguales comparten el trabajo).
     */
    public generateFeed(): Promise<string | undefined> {
        const key = this.getFeedCacheKey();

        const hit = Channel.feedCache.get(key);
        if (hit) {
            if (hit.expires > Date.now()) {
                console.info(`[FEED CACHE] hit ${key}`);
                return Promise.resolve(hit.xml);
            }
            Channel.feedCache.delete(key);
        }

        const inFlight = Channel.feedInFlight.get(key);
        if (inFlight) {
            console.info(`[FEED CACHE] joining in-flight request ${key}`);
            return inFlight;
        }

        const promise: Promise<string | undefined> = this.buildFeed()
            .then((xml) => {
                if (xml !== undefined && this.feedCacheable && Channel.FEED_CACHE_TTL_MS > 0) {
                    Channel.storeFeed(key, xml);
                }
                return xml;
            })
            .finally(() => {
                if (Channel.feedInFlight.get(key) === promise) {
                    Channel.feedInFlight.delete(key);
                }
            });

        Channel.feedInFlight.set(key, promise);
        return promise;
    }

    protected async buildFeed(): Promise<string | undefined> {
        console.info(`Creating rss feed.`);

        await Channel.initializeCache();

        console.debug(`Getting channel information.`);
        await this.fetchChannelInformation();

        console.debug(`Retrieving list of chapters.`);
        const startTime = performance.now();
        const chapters = await this.fetchEpisodeList();
        const endTime = performance.now();
        console.info(`${chapters.length} chapters found for channel ${this.channelName} in ${endTime - startTime} ms.`);

        const feed = new Podcast({
            title: this.channelName,
            author: this.author,
            description: this.description,
            imageUrl: this.imageUrl,
            itunesImage: this.imageUrl,
            ttl: this.ttlInMinutes,
            siteUrl: this.link,
            generator: 'dirtyrss',
            customNamespaces: {
                itunes: 'http://www.itunes.com/dtds/podcast-1.0.dtd',
                podcast: 'https://podcastindex.org/namespace/1.0',
            }
        });

        chapters.forEach(c => {
            feed.addItem({
                title: c.title,
                date: c.date.toUTCString(),
                description: c.description,
                imageUrl: c.image,
                itunesImage : c.image,
                itunesDuration : c.duration,
                enclosure: {
                    url: c.fileUrl,
                    type: c.mimeType,
                    size: c.length
                }
            });
        });

        return feed.buildXml();
    }
}
