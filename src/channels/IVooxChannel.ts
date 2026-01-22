import * as cheerio from "cheerio";
import { pRateLimit } from 'p-ratelimit';
import { default as got } from 'got';
import { Chapter } from '../models/Chapter.js';
import { Channel } from './Channel.js';
import { performance } from 'perf_hooks';
import { ChapterCacheKey } from '../cache/IChapterCache.js';

export class IVooxChannel extends Channel {

    // Lock en memoria para evitar fetches concurrentes
    private static activeFetches = new Set<string>();

    private static readonly EPISODE_NAME_SELECTOR:string = 'h1';
    private static readonly PODCAST_AUTHOR_SELECTOR:string = 'a.text-black.font-weight-normal';
    private static readonly PODCAST_DESCRIPTION_SELECTOR:string = '.d-flex > .d-none > .text-truncate-3';
    private static readonly PODCAST_IMAGE_SELECTOR:string = '.image-wrapper img';
    private static readonly PODCAST_IMAGE2_SELECTOR:string = '.image-wrapper.pr-2 img';
    private static readonly PODCAST_NUM_CHAPTERS_SELECTOR:string = '.stat > .text-gray:first';

    private static readonly EPISODE_DATE_AND_DURATION_SELECTOR:string = 'span.ml-sm-1';
    private static readonly EPISODE_DESCRIPTION_SELECTOR:string = 'div.mb-3 > div > p.text-truncate-5';
    private static readonly EPISODE_SELECTOR:string = '.d-flex > .d-flex > h3 > a';
    private static readonly EPISODE_IMAGE_SELECTOR:string = '.image-wrapper.pr-2 > picture > img';

    private static readonly LOGO_PATH: string = 'assets/ivoox-logo.svg';
    private static readonly BADGE_COLOR: string = '#F76D0E';
    
    private static readonly IVOOX_FETCH_TIMEOUT_MS:number = parseInt(process.env.IVOOX_FETCH_TIMEOUT_MS ?? "8000");
    private static readonly IVOOX_FETCH_PAGES_BATCH_SIZE:number = parseInt(process.env.IVOOX_FETCH_PAGES_BATCH_SIZE ?? "5");
    private static readonly IVOOX_MAX_REQUESTS_PER_SECOND:number = parseInt(process.env.IVOOX_MAX_CALLS_PER_SECOND ?? "90");
    private static readonly IVOOX_CHAPTERS_PER_PAGE:number = parseInt(process.env.IVOOX_CHAPTERS_PER_PAGE ?? "20");

    private static readonly IVOOX_REQUEST_OPTIONS = {
        headers: {
            'User-Agent': "Wget/version (linux-gnu)"
        }
    }

    private channelUrl? : string;
    private numChapters:number = 0;
    private staticFilesPath: string = '';
    private chapterUrlPrefix: string = '';

    constructor(channelName: string, chapterUrlPrefix: string = '', staticFilesPath: string = '/tmp/public') {
        super(channelName);
        this.chapterUrlPrefix = chapterUrlPrefix;
        this.staticFilesPath = staticFilesPath;
    }
    
    protected getLogoPath(): string | undefined {
        return IVooxChannel.LOGO_PATH;
    }
    
    protected getBadgeColor(): string | undefined {
        return IVooxChannel.BADGE_COLOR;
    }

    private fromSpanishDate(text: string): Date {
        const parts = text.split(/[\/·:]/);
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);

        return new Date(year, month, day);
    }

    /**
     * Helper para cargar y parsear HTML con Cheerio, liberando memoria después de extraer datos
     * Limita el scope del DOM cargado para ayudar al Garbage Collector
     * @param html HTML string a parsear
     * @param extractor Función que extrae los datos necesarios del DOM
     * @returns Los datos extraídos
     */
    private parseAndExtract<T>(html: string, extractor: ($: cheerio.Root) => T): T {
        const $ = cheerio.load(html);
        const result = extractor($);
        // El DOM de Cheerio sale de scope aquí, ayudando al GC a liberar memoria
        return result;
    }

    protected async fetchChannelInformation(): Promise<void> {
        console.info(`Configuring feed from ${this.channelUrl}`);
        const channelHtml = (await this.requestIvoox(this.channelUrl || '')).body;
        
        const { channelName, author, description, imageUrl, numChapters } = this.parseAndExtract(channelHtml, ($) => {
            const rawImageUrl = $(IVooxChannel.PODCAST_IMAGE_SELECTOR).attr('src')?.trim() || 
                               $(IVooxChannel.PODCAST_IMAGE2_SELECTOR).attr('data-lazy-src')?.trim();
            
            return {
                channelName: $('h1').text().trim(),
                author: $(IVooxChannel.PODCAST_AUTHOR_SELECTOR).text().trim(),
                description: $(IVooxChannel.PODCAST_DESCRIPTION_SELECTOR).text().trim(),
                imageUrl: rawImageUrl,
                numChapters: parseInt($(IVooxChannel.PODCAST_NUM_CHAPTERS_SELECTOR).text().replace('.','').trim())
            };
        });
        
        this.channelName = channelName;
        this.author = author;
        this.description = description;
        this.imageUrl = imageUrl && imageUrl.includes('url=') ? imageUrl.split('url=')[1] : (imageUrl || '');
        this.numChapters = numChapters;
        this.ttlInMinutes = 60;
        this.siteUrl = this.channelUrl;
        this.link = this.channelUrl;
        
        // Aplicar watermark
        await this.applyChannelWatermark(this.staticFilesPath, this.chapterUrlPrefix);
    }

    protected async fetchEpisodeList(): Promise<Chapter[]> {
        const startTime = performance.now();
        const lockKey = `ivoox:${this.channelName}`;
        
        // Si ya hay un fetch activo, devolver caché
        if (IVooxChannel.activeFetches.has(lockKey)) {
            console.log(`Fetch already in progress for ${lockKey}, returning cached data`);
            const cachedChapters = await this.getCachedFeed();
            if (cachedChapters) {
                return cachedChapters;
            }
            console.log(`No cache available while fetch in progress, returning empty array`);
            return [];
        }
        
        console.log(`Chapters: ${this.numChapters}`);

        // Obtener el primer capítulo completo de la primera página para comprobar caché
        const firstChapter = await this.getFirstChapter();
        
        if (firstChapter && this.channelUrl) {
            const feedCacheKey = ChapterCacheKey.forFeedCache('ivoox', this.channelName, firstChapter.id);
            
            console.log(`Channel URL: ${this.channelUrl}`);
            console.log(`First chapter - id: ${firstChapter.id}, title: ${firstChapter.title}, fileUrl: ${firstChapter.fileUrl}`);
            console.log(`Feed cache key: ${feedCacheKey}`);
            
            const cachedChapters = await Channel.chapterCache.getChapterList(feedCacheKey);
            
            console.log(`Cache result: ${cachedChapters ? `found ${cachedChapters.length} chapters` : 'NOT FOUND'}`);
            
            if (cachedChapters) {
                // Validar que la caché tiene la cantidad correcta de episodios
                if (cachedChapters.length >= this.numChapters) {
                    const endTime = performance.now();
                    console.log(`Feed cache hit! First chapter unchanged (${firstChapter.title}). Returning ${cachedChapters.length} cached chapters in ${(endTime - startTime).toFixed(2)}ms`);
                    return cachedChapters;
                } else {
                    console.log(`Feed cache invalid: cached ${cachedChapters.length} chapters but podcast now has ${this.numChapters}. Re-fetching...`);
                }
            } else {
                console.log(`Feed cache miss. First chapter: "${firstChapter.title}". Fetching all episodes...`);
            }
        }

        // Adquirir lock
        IVooxChannel.activeFetches.add(lockKey);
        
        try {
            const pageNumbers = Array.from({ length: Math.ceil(this.numChapters/IVooxChannel.IVOOX_CHAPTERS_PER_PAGE) }, (_, i) => i + 1);
            
            let collectedChapters: Chapter[] = [];
            let timeoutReached = false;
            let hasBackgroundLoading = false;
        
            const timeoutPromise = new Promise<Chapter[]>((_, reject) => {
                setTimeout(() => {
                    timeoutReached = true;
                    reject(new Error('Timeout reached'));
                }, IVooxChannel.IVOOX_FETCH_TIMEOUT_MS);
            });
        
            try {
                for (let i = 0; i < pageNumbers.length && !timeoutReached; i += IVooxChannel.IVOOX_FETCH_PAGES_BATCH_SIZE) {
                    const batch = pageNumbers.slice(i, i + IVooxChannel.IVOOX_FETCH_PAGES_BATCH_SIZE);
                    
                    try {
                        const batchResults = await Promise.race([
                            Promise.all(batch.map(page => this.fetchPageEpisodeList(page))),
                            timeoutPromise
                        ]) as Chapter[][];
        
                        for (const pageChapters of batchResults) {
                            collectedChapters.push(...pageChapters);
                        }
                    } catch (error) {
                        if (timeoutReached && collectedChapters.length < this.numChapters) {
                            const remainingPages = pageNumbers.slice(i + batch.length);
                            if (remainingPages.length > 0) {
                                hasBackgroundLoading = true;
                                this.continueLoadingInBackground(remainingPages, collectedChapters, firstChapter);
                            }
                            break;
                        }
                        throw error;
                    }
                }
            } catch (error) {
                if (!timeoutReached) {
                    throw error;
                }
            }
        
            collectedChapters.sort((a, b) => b.date.getTime() - a.date.getTime());

            // Guardar en caché SOLO si hemos cargado la lista completa (sin background loading)
            if (!hasBackgroundLoading && firstChapter && this.channelUrl) {
                const feedCacheKey = ChapterCacheKey.forFeedCache('ivoox', this.channelName, firstChapter.id);
                console.log(`[DEBUG] Saving to cache with key: ${feedCacheKey}`);
                await Channel.chapterCache.setChapterList(feedCacheKey, collectedChapters);
                console.log(`Feed cached with ${collectedChapters.length} chapters (complete list). First chapter: "${firstChapter.title}"`);
            } else if (hasBackgroundLoading) {
                console.log(`Feed NOT cached (${collectedChapters.length} chapters loaded, background loading in progress)`);
            }

            const endTime = performance.now();
            console.log(`fetchEpisodeList completed in ${(endTime - startTime).toFixed(2)}ms`);

            return collectedChapters;
        } finally {
            // SIEMPRE liberar el lock
            IVooxChannel.activeFetches.delete(lockKey);
        }
    }
    
    private async getCachedFeed(): Promise<Chapter[] | undefined> {
        const firstChapter = await this.getFirstChapter();
        if (!firstChapter || !this.channelUrl) {
            return undefined;
        }
        
        const feedCacheKey = ChapterCacheKey.forFeedCache('ivoox', this.channelName, firstChapter.id);
        return await Channel.chapterCache.getChapterList(feedCacheKey);
    }
    
    private async getFirstChapter(): Promise<Chapter | undefined> {
        try {
            const firstPageUrl = this.channelUrl?.replace('_1.html', '_1.html');
            if (!firstPageUrl) {
                return undefined;
            }

            const pageHtml = (await IVooxChannel.limit(async () => await this.requestIvoox(firstPageUrl))).body || '';
            
            const firstEpisodeHref = this.parseAndExtract(pageHtml, ($) => {
                const firstEpisode = $(IVooxChannel.EPISODE_SELECTOR).first();
                return firstEpisode.length > 0 ? firstEpisode.attr('href') : undefined;
            });
            
            if (firstEpisodeHref) {
                const episodeUrl = `https://ivoox.com${firstEpisodeHref}`;
                return await this.fetchChapterData(episodeUrl);
            }
            
            return undefined;
        } catch (error) {
            console.error('Error getting first chapter:', error);
            return undefined;
        }
    }

    private async continueLoadingInBackground(remainingPages: number[], existingChapters: Chapter[], firstChapter?: Chapter): Promise<void> {
        const startTime = performance.now();
        const lockKey = `ivoox:${this.channelName}`;
        console.log(`Continuing chapter fetch in background for ${remainingPages.length} remaining pages`);
        
        const backgroundChapters: Chapter[] = [];
        
        try {
            await Promise.allSettled(
                remainingPages.map(async (page) => {
                    try {
                        const chapters = await this.fetchPageEpisodeList(page);
                        backgroundChapters.push(...chapters);
                    } catch (error) {
                        console.error(`Error fetching page ${page} in background:`, error);
                    }
                })
            );
            
            const endTime = performance.now();
            const totalChapters = existingChapters.length + backgroundChapters.length;
            console.log(`Background fetch completed. Total chapters: ${totalChapters}, Background chapters: ${backgroundChapters.length}`);
            console.log(`Background fetch completed in ${(endTime - startTime).toFixed(2)}ms`);
            
            // Ahora que tenemos la lista completa, cachearla
            if (firstChapter && this.channelUrl && backgroundChapters.length > 0) {
                const allChapters = [...existingChapters, ...backgroundChapters];
                allChapters.sort((a, b) => b.date.getTime() - a.date.getTime());
                
                const feedCacheKey = ChapterCacheKey.forFeedCache('ivoox', this.channelName, firstChapter.id);
                await Channel.chapterCache.setChapterList(feedCacheKey, allChapters);
                console.log(`Feed cached with complete list (${allChapters.length} chapters) after background loading. First chapter: "${firstChapter.title}"`);
            }
            
        } catch (error) {
            console.error('Error during background fetch:', error);
        } finally {
            // Liberar lock después del background loading
            IVooxChannel.activeFetches.delete(lockKey);
        }
    }

    private async fetchPageEpisodeList(pageNumber: number) : Promise<Chapter[]> {

        const currentPageUrl = this.channelUrl?.replace('_1.html', `_${pageNumber}.html`);
        console.log(`  +Fetching page ${pageNumber} from ${currentPageUrl}`);

        const pageHtml = (await IVooxChannel.limit(async () => await this.requestIvoox(currentPageUrl || ''))).body || '';
        
        const episodesData = this.parseAndExtract(pageHtml, ($) => {
            const episodeElements = $(IVooxChannel.EPISODE_SELECTOR).toArray();
            const episodes: Array<{title: string, url: string}> = [];
            
            for (const element of episodeElements) {
                const $elem = $(element);
                const href = $elem.attr('href');
                if (href) {
                    episodes.push({
                        title: $elem.text().trim(),
                        url: `https://ivoox.com${href}`
                    });
                }
            }
            return episodes;
        });
        
        const chapters = await Promise.all(
            episodesData.map(ep => this.fetchChapterData(ep.url))
        );
        return chapters;
    }

    protected async fetchChapterData(url: string): Promise<Chapter> {
        const matches = url.match(/\d{6,12}/g) || [];
        const id = matches.pop()!;
        
        const cacheKey = ChapterCacheKey.forChapter('ivoox', this.channelName, id);
        
        const cachedChapter = await Channel.chapterCache.get(cacheKey);
        if (cachedChapter) {
            return cachedChapter;
        }
        
        const chapterHtml = (await IVooxChannel.limit(async () => await this.requestIvoox(url))).body;
        const audioRealUrl = `https://www.ivoox.com/listenembeded_mn_${id}_1.mp3?source=EMBEDEDHTML5`;

        const { title, description, dateText, duration, img } = this.parseAndExtract(chapterHtml, ($) => {
            const dateAndDurationText = $(IVooxChannel.EPISODE_DATE_AND_DURATION_SELECTOR).text();
            const parts = dateAndDurationText.split('·');
            
            const rawImg = $(IVooxChannel.EPISODE_IMAGE_SELECTOR).attr('src')?.trim() || 
                          $(IVooxChannel.EPISODE_IMAGE_SELECTOR).attr('data-lazy-src')?.trim() || '';
            
            return {
                title: $(IVooxChannel.EPISODE_NAME_SELECTOR).text().trim(),
                description: $(IVooxChannel.EPISODE_DESCRIPTION_SELECTOR).text().trim(),
                dateText: parts[0]?.trim() || '01/01/2000',
                duration: parts[1]?.trim() || '00:00',
                img: rawImg
            };
        });

        let date = this.fromSpanishDate('01/01/2000');
        try {
            date = this.fromSpanishDate(dateText);
        } catch (error) {  
            console.error(`Error parsing date "${dateText}" for chapter ${title}:`, error);
        }
        
        const finalImg = img.includes('url=') ? img.split('url=')[1] : img;

        const chapter = new Chapter(id, title, audioRealUrl, description, date, finalImg, duration);
        console.debug(`    ++Podcast "${this.channelName}" chapter "${title}", url=(${url}).`);
        
        Channel.chapterCache.set(cacheKey, chapter);

        return chapter;
    }

    private async findChannelUrl(): Promise<string | undefined> {
        console.info(`Searching for the program "${this.channelName}"`);
        const normalizedName = this.channelName.trim().toLowerCase().replace(/ /g, '-');
        const searchURL = `https://www.ivoox.com/${normalizedName}_sw_1_1.html`;
        const searchHtml = (await this.requestIvoox(searchURL)).body;

        console.debug(`Looking for the program url.`);
        
        const programUrl = this.parseAndExtract(searchHtml, ($) => {
            const selector = `.modulo-type-programa .header-modulo a`;
            return $(selector).attr('href')?.toString();
        });
        
        console.debug(`Program url: ${programUrl}.`);

        return programUrl;
    }

    private requestIvoox(url: string) {
        return got(url, IVooxChannel.IVOOX_REQUEST_OPTIONS);
    }

    public async generateFeed(): Promise<string | undefined> {
        console.info(`Creating rss feed.`);
        console.debug(`Getting channel ${this.channelName} url.`);
        this.channelUrl = await this.findChannelUrl();
        if (this.channelUrl === undefined) {
            console.warn(`Channel url not found for ${this.channelName}.`);
            return;
        }
        console.info(`Channel url is ${this.channelUrl}.`);
        return super.generateFeed();
    }

    private static limit = pRateLimit({
        interval: 1000,
        rate: IVooxChannel.IVOOX_MAX_REQUESTS_PER_SECOND,
        concurrency: IVooxChannel.IVOOX_MAX_REQUESTS_PER_SECOND*1.2,
        maxDelay: 5 * 60000
    });
}
//# sourceMappingURL=IVooxChannel.js.map