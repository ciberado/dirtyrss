import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { default as got } from 'got';

export interface PlatformWatermarkConfig {
    logoPath: string;          // Ruta al logo SVG o PNG
    backgroundColor: string;   // Color de fondo del badge (ej: "#9146FF")
    badgeShape: 'circle' | 'squircle' | 'blob';  // Forma del badge
    badgeSize: number;         // Tamaño relativo al ancho de la imagen (0-1)
}

export class ImageProcessor {
    private staticFilesPath: string;
    private chapterUrlPrefix: string;

    constructor(staticFilesPath: string, chapterUrlPrefix: string) {
        this.staticFilesPath = staticFilesPath;
        this.chapterUrlPrefix = chapterUrlPrefix;
    }

    /**
     * Procesa una imagen de canal añadiendo un watermark según la configuración de la plataforma
     */
    async processChannelImage(
        originalImageUrl: string | undefined,
        platformName: string,
        channelId: string,
        config: PlatformWatermarkConfig,
        ttlHours: number = 24
    ): Promise<string | undefined> {
        try {
            if (!originalImageUrl) {
                console.warn(`No image URL provided for ${platformName}/${channelId}`);
                return originalImageUrl;
            }

            const coversDir = `${this.staticFilesPath}/${platformName}/covers`;
            const sanitizedChannelId = channelId.replace(/\s+/g, '_');
            
            // Buscar imágenes existentes del canal
            if (fs.existsSync(coversDir)) {
                const files = fs.readdirSync(coversDir)
                    .filter(f => f.startsWith(`${sanitizedChannelId}_`) && f.endsWith('.jpg'));
                
                if (files.length > 0) {
                    // Obtener la más reciente
                    const latestFile = files.sort().reverse()[0];
                    const timestamp = parseInt(latestFile.split('_')[1].replace('.jpg', ''));
                    const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
                    
                    // Si es reciente, usarla
                    if (ageHours < ttlHours) {
                        return `${this.chapterUrlPrefix}/${platformName}/covers/${latestFile}`;
                    }
                    
                    // Borrar versiones antiguas
                    files.forEach(f => {
                        const filePath = `${coversDir}/${f}`;
                        fs.unlinkSync(filePath);
                        console.log(`Deleted old image: ${filePath}`);
                    });
                }
            }
            
            // Generar nueva imagen con timestamp
            const timestamp = Date.now();
            const processedImagePath = `${coversDir}/${sanitizedChannelId}_${timestamp}.jpg`;
            
            // Crear directorio si no existe
            const dir = path.dirname(processedImagePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            console.log(`Processing channel image for ${platformName}/${channelId}`);
            const response = await got(originalImageUrl).buffer();
            
            // Convertir imagen a cuadrada (recortar desde el centro)
            const metadata = await sharp(response).metadata();
            const minDimension = Math.min(metadata.width || 300, metadata.height || 300);
            
            const squareImageBuffer = await sharp(response)
                .resize(minDimension, minDimension, {
                    fit: 'cover',
                    position: 'center'
                })
                .toBuffer();
            
            // Verificar si existe el logo
            if (!fs.existsSync(config.logoPath)) {
                console.warn(`Logo not found at ${config.logoPath}, skipping watermark`);
                await sharp(squareImageBuffer).jpeg({ quality: 90 }).toFile(processedImagePath);
                return `${this.chapterUrlPrefix}/${platformName}/covers/${sanitizedChannelId}_${timestamp}.jpg`;
            }
            
            // Procesar imagen con watermark
            const badgeSize = Math.floor(minDimension * config.badgeSize);
            
            // Crear el badge según la forma configurada
            const badgeBuffer = await this.createBadge(config, badgeSize);
            
            // Recortar el badge a su contenido (eliminar transparencia)
            const trimmedBadge = await sharp(badgeBuffer)
                .trim()
                .toBuffer();
            
            const trimmedMetadata = await sharp(trimmedBadge).metadata();
            
            // Componer el badge pegado a los bordes superior y derecho
            await sharp(squareImageBuffer)
                .composite([{
                    input: trimmedBadge,
                    top: 0,
                    left: minDimension - trimmedMetadata.width!
                }])
                .jpeg({ quality: 90 })
                .toFile(processedImagePath);
            
            console.log(`Channel image processed with watermark for ${platformName}/${channelId}`);
            return `${this.chapterUrlPrefix}/${platformName}/covers/${sanitizedChannelId}_${timestamp}.jpg`;
            
        } catch (err) {
            console.error(`Error processing channel image for ${platformName}/${channelId}:`, err);
            return originalImageUrl;
        }
    }

    /**
     * Crea un badge con el logo sobre una forma de fondo
     */
    private async createBadge(config: PlatformWatermarkConfig, badgeSize: number): Promise<Buffer> {
        const logoSize = Math.floor(badgeSize * 0.45); // 45% del tamaño del badge (más pequeño)
        
        // Leer el SVG y forzar color blanco
        const logoSvgString = fs.readFileSync(config.logoPath, 'utf-8');
        
        // Envolver el SVG en un grupo con fill blanco
        const whiteLogo = logoSvgString
            .replace(/<svg/, '<svg fill="#FFFFFF"')
            .replace(/<path/g, '<path fill="#FFFFFF"');
        
        const logoBuffer = await sharp(Buffer.from(whiteLogo))
            .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
        
        // Cargar la máscara PNG del badge (desde directorio original)
        const shapePath = `${path.resolve('.')}/assets/badge-shape.png`;
        
        if (!fs.existsSync(shapePath)) {
            console.warn(`Badge shape not found at ${shapePath}, using SVG fallback`);
            const badgeSvg = await this.createBadgeWithLogo(config.badgeShape, badgeSize, config.backgroundColor, logoBuffer, logoSize);
            return await sharp(Buffer.from(badgeSvg)).png().toBuffer();
        }
        
        // Redimensionar el shape (fill para que ocupe todo el espacio sin márgenes)
        const { data, info } = await sharp(shapePath)
            .resize(badgeSize, badgeSize, { fit: 'fill', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        // Parsear el color hex a RGB
        const hex = config.backgroundColor.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        
        // Recolorear manualmente: donde hay negro, poner el color, conservando alpha
        const pixels = Buffer.from(data.buffer);
        for (let i = 0; i < pixels.length; i += 4) {
            const alpha = pixels[i + 3];
            if (alpha > 0) {
                pixels[i] = r;     // R
                pixels[i + 1] = g; // G
                pixels[i + 2] = b; // B
            }
        }
        
        const coloredShape = await sharp(pixels, {
            raw: {
                width: info.width,
                height: info.height,
                channels: 4
            }
        }).png().toBuffer();
        
        // Componer logo sobre el shape coloreado (desplazado arriba y derecha)
        return await sharp(coloredShape)
            .composite([{
                input: logoBuffer,
                top: Math.floor(badgeSize * 0.22),
                left: Math.floor(badgeSize * 0.32)
            }])
            .png()
            .toBuffer();
    }

    /**
     * Crea un badge completo con logo embebido
     */
    private async createBadgeWithLogo(shape: string, size: number, color: string, logoBuffer: Buffer, logoSize: number): Promise<string> {
        // Convertir el logo a base64 para embeber en SVG
        const logoBase64 = logoBuffer.toString('base64');
        const logoX = size * 0.3;
        const logoY = size * 0.15;
        
        switch (shape) {
            case 'blob':
                // Forma orgánica desde la esquina superior derecha
                return `
                    <svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                        <path d="M 100 0
                                 L 100 35
                                 C 100 42, 99 49, 96 55
                                 C 93 61, 88 66, 82 70
                                 C 76 74, 68 77, 60 78
                                 C 52 79, 43 78, 35 76
                                 C 27 74, 19 70, 13 65
                                 C 7 60, 3 53, 1 46
                                 C -1 39, -1 31, 1 24
                                 C 3 17, 7 11, 13 7
                                 C 19 3, 27 0, 35 0
                                 Z" 
                              fill="${color}"/>
                        <image x="50" y="18" width="${logoSize/size*100}" height="${logoSize/size*100}" href="data:image/png;base64,${logoBase64}"/>
                    </svg>`;
            
            default:
                const centerX = (size - logoSize) / 2;
                const centerY = (size - logoSize) / 2;
                return `
                    <svg width="${size}" height="${size}">
                        <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="${color}"/>
                        <image x="${centerX}" y="${centerY}" width="${logoSize}" height="${logoSize}" href="data:image/png;base64,${logoBase64}"/>
                    </svg>`;
        }
    }
}
