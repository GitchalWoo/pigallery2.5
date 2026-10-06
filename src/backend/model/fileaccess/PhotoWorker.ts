/* eslint-disable @typescript-eslint/no-var-requires */
const sharp = require('sharp') as typeof import('sharp');
import {Metadata, Sharp, SharpOptions} from 'sharp';
import {Logger} from '../../Logger';
import {FFmpegCommand, FfprobeData, FFmpegFactory} from '../FFmpegFactory';
import {promises as fsp} from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as exifr from 'exifr';
import {ExtensionDecorator} from '../extension/ExtensionDecorator';

const RAW_EXTENSIONS = new Set(['.cr2', '.cr3', '.arw', '.nef', '.nrw', '.orf', '.rw2', '.pef', '.raf']);

sharp.cache(false);

export class PhotoWorker {
  private static videoRenderer: (input: MediaRendererInput) => Promise<void> = null;

  public static render(input: SvgRendererInput | MediaRendererInput): Promise<void> {
    if (input.type === ThumbnailSourceType.Photo) {
      return this.renderFromImage(input);
    }
    if (input.type === ThumbnailSourceType.Video) {
      return this.renderFromVideo(input as MediaRendererInput);
    }
    throw new Error('Unsupported media type to render thumbnail:' + input.type);
  }

  public static renderFromImage(input: SvgRendererInput | MediaRendererInput, dryRun = false): Promise<void> {
    return ImageRendererFactory.render(input, dryRun);
  }

  public static renderFromVideo(input: MediaRendererInput): Promise<void> {
    if (PhotoWorker.videoRenderer === null) {
      PhotoWorker.videoRenderer = VideoRendererFactory.build();
    }
    return PhotoWorker.videoRenderer(input);
  }
}

export enum ThumbnailSourceType {
  Photo = 1,
  Video = 2,
}

interface RendererInput {
  type: ThumbnailSourceType;
  size: number;
  makeSquare?: boolean;
  outPath?: string;
  quality: number;
  useLanczos3: boolean;
  cut?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface MediaRendererInput extends RendererInput {
  mediaPath: string;
  smartSubsample: boolean;
  sharpOptions: SharpOptions;
  animate: boolean; // animates the output. Used for Gifs
}

export interface SvgRendererInput extends RendererInput {
  svgString: string;
}

export class VideoRendererFactory {
  public static build(): (input: MediaRendererInput) => Promise<void> {
    const ffmpeg = FFmpegFactory.get();
    return (input: MediaRendererInput): Promise<void> => {
      return new Promise((resolve, reject): void => {
        Logger.silly('[FFmpeg] rendering thumbnail: ' + input.mediaPath);

        ffmpeg(input.mediaPath).ffprobe((err: Error, data: FfprobeData): void => {
          if (!!err || data === null) {
            return reject('[FFmpeg] ' + err.toString());
          }

          let width = null;
          let height = null;
          for (const stream of data.streams) {
            if (stream.width && stream.height && !isNaN(stream.width) && !isNaN(stream.height)) {
              width = stream.width;
              height = stream.height;
              break;
            }
          }
          if (!width || !height || isNaN(width) || isNaN(height)) {
            return reject(`[FFmpeg] Can not read video dimension. Found: ${width}x${height}`);
          }
          const command: FFmpegCommand = ffmpeg(input.mediaPath);
          const fileName = path.basename(input.outPath);
          const folder = path.dirname(input.outPath);
          let executedCmd = '';
          command
            .on('start', (cmd: string): void => {
              executedCmd = cmd;
            })
            .on('end', (): void => {
              resolve();
            })
            .on('error', (e: any): void => {
              reject('[FFmpeg] ' + e.toString() + ' executed: ' + executedCmd);
            })
            .outputOptions(['-qscale:v 50']);
          if (input.makeSquare === false) {
            const newSize =
              width < height
                ? Math.min(input.size, width) + 'x?'
                : '?x' + Math.min(input.size, height);
            command.takeScreenshots({
              timemarks: ['10%'],
              size: newSize,
              filename: fileName,
              folder,
            });
          } else {
            command.takeScreenshots({
              timemarks: ['10%'],
              size: input.size + 'x' + input.size,
              filename: fileName,
              folder,
            });
          }
        });
      });
    };
  }
}

export class ImageRendererFactory {

  public static async getRawPreviewBuffer(filePath: string): Promise<Buffer | null> {
    try {
      const parsed = await exifr.parse(filePath, {tiff: true, mergeOutput: false});
      let offset = parsed?.ifd0?.StripOffsets;
      let length = parsed?.ifd0?.StripByteCounts;
      if (Array.isArray(offset) && offset.length > 0) {
        offset = offset[0];
      }
      if (Array.isArray(length) && length.length > 0) {
        length = length[0];
      }
      if (typeof offset !== 'number' || typeof length !== 'number') {
        if (typeof parsed?.ifd0?.ThumbnailOffset === 'number' && typeof parsed?.ifd0?.ThumbnailLength === 'number') {
          offset = parsed.ifd0.ThumbnailOffset;
          length = parsed.ifd0.ThumbnailLength;
        }
      }
      if (typeof offset === 'number' && typeof length === 'number') {
        const handle = await fsp.open(filePath, 'r');
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, offset);
        await handle.close();
        return buf;
      }
    } catch {
      // ignore
    }
    const thumb = await exifr.thumbnail(filePath);
    return thumb ? Buffer.from(thumb) : null;
  }

  @ExtensionDecorator(e => e.gallery.ImageRenderer.render)
  public static async render(input: MediaRendererInput | SvgRendererInput, dryRun = false): Promise<void> {

    let image: Sharp;
    if ((input as MediaRendererInput).mediaPath) {
      const mediaPath = (input as MediaRendererInput).mediaPath;
      Logger.silly(
        '[SharpRenderer] rendering photo:' +
        mediaPath +
        ', size:' +
        input.size
      );
      const ext = path.extname(mediaPath).toLowerCase();
      if (RAW_EXTENSIONS.has(ext)) {
        try {
          const previewBuf = await ImageRendererFactory.getRawPreviewBuffer(mediaPath);
          if (previewBuf) {
            image = sharp(previewBuf, {
              failOn: 'none',
              animated: false,
              ...((input as MediaRendererInput).sharpOptions || {})
            });
          }
        } catch (e) {
          Logger.debug('[SharpRenderer] Failed to extract raw preview: ' + e);
        }
      }
      if (!image) {
        image = sharp(mediaPath, {
          failOn: 'none',
          animated: (input as MediaRendererInput).animate, ...((input as MediaRendererInput).sharpOptions || {})
        });
      }
    } else {
      const svg_buffer = Buffer.from((input as SvgRendererInput).svgString);
      image = sharp(svg_buffer, {density: 450});
    }
    image.rotate();
    const metadata: Metadata = await image.metadata();
    const kernel =
      input.useLanczos3 === true
        ? sharp.kernel.lanczos3
        : sharp.kernel.nearest;

    if (input.cut) {
      image.extract(input.cut);
    }
    if (input.makeSquare === false) {
      if (metadata.height > metadata.width) {
        image.resize(Math.min(input.size, metadata.width), null, {
          kernel,
        });
      } else {
        image.resize(null, Math.min(input.size, metadata.height), {
          kernel,
        });
      }
    } else {
      image.resize(input.size, input.size, {
        kernel,
        position: sharp.gravity.centre,
        fit: 'cover',
      });
    }
    let processedImg: Sharp;
    if ((input as MediaRendererInput).mediaPath) {
      processedImg = image.webp({
        effort: 6,
        quality: input.quality,
        smartSubsample: (input as MediaRendererInput).smartSubsample
      });
    } else {
      if ((input as SvgRendererInput).svgString) {
        processedImg = image.png({effort: 6, quality: input.quality});
      }
    }
    // do not save to file
    if (dryRun) {
      await processedImg.toFormat('webp').toBuffer();
      return;
    }
    await processedImg.toFile(input.outPath);

  }
}
