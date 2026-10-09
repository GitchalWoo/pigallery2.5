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
  cutOriginalSize?: {
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

export const MAX_COMPRESSED_PREVIEW_BYTES = 32 * 1024 * 1024; // 32 MiB

export interface RawPreviewResult {
  buffer: Buffer;
  orientation: number; // effective EXIF orientation (1-8)
  containerOrientation?: number;
  previewOrientation?: number;
  source: 'strip' | 'thumbnail' | 'exifr-thumb';
}

export class ImageRendererFactory {

  public static parseSafeRange(rawOffset: unknown, rawLength: unknown): {offset: number; length: number} | null {
    const isOffsetArr = Array.isArray(rawOffset);
    const isLengthArr = Array.isArray(rawLength);
    if (isOffsetArr !== isLengthArr) {
      return null;
    }
    let off = rawOffset;
    let len = rawLength;
    if (isOffsetArr) {
      if ((rawOffset as unknown[]).length !== 1 || (rawLength as unknown[]).length !== 1) {
        return null;
      }
      off = (rawOffset as unknown[])[0];
      len = (rawLength as unknown[])[0];
    }
    if (typeof off !== 'number' || typeof len !== 'number') {
      return null;
    }
    if (!Number.isSafeInteger(off) || !Number.isSafeInteger(len)) {
      return null;
    }
    if (off < 0 || len <= 0) {
      return null;
    }
    return {offset: off, length: len};
  }

  public static async readByteRange(filePath: string, offset: number, length: number): Promise<Buffer> {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0) {
      throw new Error(`Invalid range parameters: offset=${offset}, length=${length}`);
    }
    if (length > MAX_COMPRESSED_PREVIEW_BYTES) {
      throw new Error(`Requested length ${length} exceeds maximum allowed preview size ${MAX_COMPRESSED_PREVIEW_BYTES}`);
    }

    const handle = await fsp.open(filePath, 'r');
    let primaryError: unknown = null;
    try {
      const stat = await handle.stat();
      const fileSize = stat.size;
      if (offset > fileSize || length > fileSize - offset) {
        throw new Error(`Requested range [${offset}, ${offset + length}) exceeds file size ${fileSize}`);
      }

      const buf = Buffer.alloc(length);
      let totalRead = 0;
      while (totalRead < length) {
        const {bytesRead} = await handle.read(buf, totalRead, length - totalRead, offset + totalRead);
        if (bytesRead === 0) {
          throw new Error(`Premature end of file: expected ${length} bytes, got ${totalRead} bytes at offset ${offset}`);
        }
        totalRead += bytesRead;
      }
      return buf;
    } catch (err) {
      primaryError = err;
      throw err;
    } finally {
      try {
        await handle.close();
      } catch (closeErr) {
        if (primaryError) {
          Logger.warn('[ImageRendererFactory] Failed to close handle after error: ' + closeErr);
        } else {
          throw closeErr;
        }
      }
    }
  }

  public static async validatePreviewCandidate(buf: Buffer): Promise<{orientation?: number} | null> {
    if (!buf || buf.length === 0 || buf.length > MAX_COMPRESSED_PREVIEW_BYTES) {
      return null;
    }
    try {
      const meta = await sharp(buf).metadata();
      if (meta.format !== 'jpeg' || !meta.width || !meta.height || meta.width <= 0 || meta.height <= 0) {
        return null;
      }
      // Decode pixels to ensure data is not corrupted/truncated
      await sharp(buf).resize(1, 1).raw().toBuffer();
      let orientation: number | undefined = undefined;
      if (typeof meta.orientation === 'number' && Number.isInteger(meta.orientation) && meta.orientation >= 1 && meta.orientation <= 8) {
        orientation = meta.orientation;
      }
      return {orientation};
    } catch {
      return null;
    }
  }

  public static applyOrientation(image: Sharp, orientation: number): Sharp {
    switch (orientation) {
      case 1:
        return image;
      case 2:
        return image.flop();
      case 3:
        return image.rotate(180);
      case 4:
        return image.flip();
      case 5:
        return image.rotate(90).flip();
      case 6:
        return image.rotate(90);
      case 7:
        return image.rotate(270).flip();
      case 8:
        return image.rotate(270);
      default:
        return image;
    }
  }

  public static async getRawPreview(filePath: string): Promise<RawPreviewResult | null> {
    let parsed: any = null;
    let containerOrientation: number | undefined = undefined;
    try {
      parsed = await exifr.parse(filePath, {tiff: true, mergeOutput: false, translateValues: false});
      const rawOri = parsed?.ifd0?.Orientation ?? parsed?.tiff?.Orientation;
      if (typeof rawOri === 'number' && Number.isInteger(rawOri) && rawOri >= 1 && rawOri <= 8) {
        containerOrientation = rawOri;
      }
    } catch (e) {
      Logger.debug('[ImageRendererFactory] exifr.parse failed: ' + e);
    }

    // Candidate 1: Strip offsets / counts
    const stripRange = ImageRendererFactory.parseSafeRange(parsed?.ifd0?.StripOffsets, parsed?.ifd0?.StripByteCounts);
    if (stripRange) {
      try {
        const buf = await ImageRendererFactory.readByteRange(filePath, stripRange.offset, stripRange.length);
        const valid = await ImageRendererFactory.validatePreviewCandidate(buf);
        if (valid) {
          const effectiveOrientation = valid.orientation ?? containerOrientation ?? 1;
          return {
            buffer: buf,
            orientation: effectiveOrientation,
            containerOrientation,
            previewOrientation: valid.orientation,
            source: 'strip',
          };
        }
      } catch (e) {
        Logger.debug('[ImageRendererFactory] Strip preview candidate failed: ' + e);
      }
    }

    // Candidate 2: Thumbnail offset / length
    const thumbRange = ImageRendererFactory.parseSafeRange(parsed?.ifd0?.ThumbnailOffset, parsed?.ifd0?.ThumbnailLength);
    if (thumbRange) {
      try {
        const buf = await ImageRendererFactory.readByteRange(filePath, thumbRange.offset, thumbRange.length);
        const valid = await ImageRendererFactory.validatePreviewCandidate(buf);
        if (valid) {
          const effectiveOrientation = valid.orientation ?? containerOrientation ?? 1;
          return {
            buffer: buf,
            orientation: effectiveOrientation,
            containerOrientation,
            previewOrientation: valid.orientation,
            source: 'thumbnail',
          };
        }
      } catch (e) {
        Logger.debug('[ImageRendererFactory] Thumbnail offset candidate failed: ' + e);
      }
    }

    // Candidate 3: exifr.thumbnail
    try {
      const thumb = await exifr.thumbnail(filePath);
      if (thumb && thumb.byteLength <= MAX_COMPRESSED_PREVIEW_BYTES) {
        const buf = Buffer.from(thumb);
        const valid = await ImageRendererFactory.validatePreviewCandidate(buf);
        if (valid) {
          const effectiveOrientation = valid.orientation ?? containerOrientation ?? 1;
          return {
            buffer: buf,
            orientation: effectiveOrientation,
            containerOrientation,
            previewOrientation: valid.orientation,
            source: 'exifr-thumb',
          };
        }
      }
    } catch (e) {
      Logger.debug('[ImageRendererFactory] exifr.thumbnail candidate failed: ' + e);
    }

    return null;
  }

  public static async getRawPreviewBuffer(filePath: string): Promise<Buffer | null> {
    const preview = await ImageRendererFactory.getRawPreview(filePath);
    return preview ? preview.buffer : null;
  }

  @ExtensionDecorator(e => e.gallery.ImageRenderer.render)
  public static async render(input: MediaRendererInput | SvgRendererInput, dryRun = false): Promise<void> {

    let image: Sharp;
    let previewResult: RawPreviewResult | null = null;
    let previewExtractError: Error | null = null;

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
          previewResult = await ImageRendererFactory.getRawPreview(mediaPath);
          if (previewResult) {
            image = sharp(previewResult.buffer, {
              failOn: 'none',
              animated: false,
              ...((input as MediaRendererInput).sharpOptions || {})
            });
            image = ImageRendererFactory.applyOrientation(image, previewResult.orientation);
          }
        } catch (e: any) {
          previewExtractError = e;
          Logger.debug('[SharpRenderer] Failed to extract raw preview: ' + e);
        }
      }
      if (!image) {
        image = sharp(mediaPath, {
          failOn: 'none',
          animated: (input as MediaRendererInput).animate,
          ...((input as MediaRendererInput).sharpOptions || {})
        });
        image.rotate();
      }
    } else {
      const svg_buffer = Buffer.from((input as SvgRendererInput).svgString);
      image = sharp(svg_buffer, {density: 450});
    }

    const metadata: Metadata = await image.metadata();
    const effectiveOrientation = previewResult
      ? previewResult.orientation
      : (typeof metadata.orientation === 'number' && metadata.orientation >= 1 && metadata.orientation <= 8 ? metadata.orientation : 1);

    const isSwapped = effectiveOrientation >= 5 && effectiveOrientation <= 8;
    const effectiveWidth = isSwapped ? metadata.height : metadata.width;
    const effectiveHeight = isSwapped ? metadata.width : metadata.height;

    const kernel =
      input.useLanczos3 === true
        ? sharp.kernel.lanczos3
        : sharp.kernel.nearest;

    let currentWidth = effectiveWidth;
    let currentHeight = effectiveHeight;

    if (input.cut) {
      let cutToApply = input.cut;
      if (input.cutOriginalSize && input.cutOriginalSize.width > 0 && input.cutOriginalSize.height > 0) {
        const scaleX = effectiveWidth / input.cutOriginalSize.width;
        const scaleY = effectiveHeight / input.cutOriginalSize.height;
        const cutLeft = Math.max(0, Math.min(Math.round(input.cut.left * scaleX), effectiveWidth - 1));
        const cutTop = Math.max(0, Math.min(Math.round(input.cut.top * scaleY), effectiveHeight - 1));
        const cutWidth = Math.max(1, Math.min(Math.round(input.cut.width * scaleX), effectiveWidth - cutLeft));
        const cutHeight = Math.max(1, Math.min(Math.round(input.cut.height * scaleY), effectiveHeight - cutTop));
        cutToApply = {left: cutLeft, top: cutTop, width: cutWidth, height: cutHeight};
      } else {
        const cutLeft = Math.max(0, Math.min(input.cut.left, effectiveWidth - 1));
        const cutTop = Math.max(0, Math.min(input.cut.top, effectiveHeight - 1));
        const cutWidth = Math.max(1, Math.min(input.cut.width, effectiveWidth - cutLeft));
        const cutHeight = Math.max(1, Math.min(input.cut.height, effectiveHeight - cutTop));
        cutToApply = {left: cutLeft, top: cutTop, width: cutWidth, height: cutHeight};
      }
      image.extract(cutToApply);
      currentWidth = cutToApply.width;
      currentHeight = cutToApply.height;
    }

    if (input.makeSquare === false) {
      if (currentHeight > currentWidth) {
        image.resize(Math.min(input.size, currentWidth), null, {
          kernel,
        });
      } else {
        image.resize(null, Math.min(input.size, currentHeight), {
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
    try {
      await processedImg.toFile(input.outPath);
    } catch (err: any) {
      if (previewExtractError) {
        Logger.error('[SharpRenderer] Error rendering photo with raw preview extraction failure:', previewExtractError);
      }
      throw err;
    }
  }
}
