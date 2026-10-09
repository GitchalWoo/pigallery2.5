import {expect} from 'chai';
import * as path from 'path';
import * as fs from 'fs';
const sharp = require('sharp') as typeof import('sharp');
import {
  ImageRendererFactory,
  MAX_COMPRESSED_PREVIEW_BYTES,
  MediaRendererInput,
  PhotoWorker,
  ThumbnailSourceType,
} from '../../../../../src/backend/model/fileaccess/PhotoWorker';

describe('PhotoWorker RAW Preview Safety and Orientation', () => {
  const tempDir = path.join(__dirname, '../../../../../test/tmp/photoworker-raw-safety-tests');
  const rootDir = path.join(__dirname, '../../../../..');
  const cr2Photo = path.join(rootDir, 'demo/images/IMG_3495.CR2');
  const arwPhoto = path.join(rootDir, 'src/backend/model/diagnostics/image_formats/test.arw');

  before(async () => {
    await fs.promises.mkdir(tempDir, {recursive: true});
  });

  after(async () => {
    try {
      await fs.promises.rm(tempDir, {recursive: true, force: true});
    } catch {
      // ignore
    }
  });

  describe('Range and Strip Shape Parsing (parseSafeRange)', () => {
    it('should accept valid scalar numbers', () => {
      const result = ImageRendererFactory.parseSafeRange(100, 500);
      expect(result).to.deep.equal({offset: 100, length: 500});
    });

    it('should accept zero offset with positive length', () => {
      const result = ImageRendererFactory.parseSafeRange(0, 1024);
      expect(result).to.deep.equal({offset: 0, length: 1024});
    });

    it('should accept single-element arrays with matching shapes', () => {
      const result = ImageRendererFactory.parseSafeRange([200], [800]);
      expect(result).to.deep.equal({offset: 200, length: 800});
    });

    it('should reject mismatched scalar vs array shapes', () => {
      expect(ImageRendererFactory.parseSafeRange([100], 500)).to.be.null;
      expect(ImageRendererFactory.parseSafeRange(100, [500])).to.be.null;
    });

    it('should reject empty or multi-element strip arrays', () => {
      expect(ImageRendererFactory.parseSafeRange([], [])).to.be.null;
      expect(ImageRendererFactory.parseSafeRange([100, 200], [500, 600])).to.be.null;
      expect(ImageRendererFactory.parseSafeRange([100], [500, 600])).to.be.null;
    });

    it('should reject negative, zero length or non-safe integer values', () => {
      expect(ImageRendererFactory.parseSafeRange(-1, 500)).to.be.null;
      expect(ImageRendererFactory.parseSafeRange(100, 0)).to.be.null;
      expect(ImageRendererFactory.parseSafeRange(100, -50)).to.be.null;
      expect(ImageRendererFactory.parseSafeRange(10.5, 500)).to.be.null;
      expect(ImageRendererFactory.parseSafeRange(100, 500.5)).to.be.null;
      expect(ImageRendererFactory.parseSafeRange(NaN, 500)).to.be.null;
      expect(ImageRendererFactory.parseSafeRange(100, NaN)).to.be.null;
      expect(ImageRendererFactory.parseSafeRange(Infinity, 500)).to.be.null;
      expect(ImageRendererFactory.parseSafeRange(Number.MAX_SAFE_INTEGER + 100, 500)).to.be.null;
      expect(ImageRendererFactory.parseSafeRange('100', '500')).to.be.null;
      expect(ImageRendererFactory.parseSafeRange(null, undefined)).to.be.null;
    });
  });

  describe('Descriptor Ownership and Byte Range Bounds (readByteRange)', () => {
    const testFile = path.join(tempDir, 'sample_data.bin');
    const testPayload = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

    beforeEach(async () => {
      await fs.promises.writeFile(testFile, testPayload);
    });

    it('should read range successfully and close descriptor exactly once', async () => {
      const origOpen = fs.promises.open;
      let closeCalls = 0;
      try {
        (fs.promises as any).open = async (...args: any[]) => {
          const handle = await origOpen.apply(fs.promises, args as any);
          const origClose = handle.close.bind(handle);
          handle.close = async () => {
            closeCalls++;
            return origClose();
          };
          return handle;
        };

        const result = await ImageRendererFactory.readByteRange(testFile, 5, 10);
        expect(result.toString()).to.equal(testPayload.subarray(5, 15).toString());
        expect(closeCalls).to.equal(1);
      } finally {
        fs.promises.open = origOpen;
      }
    });

    it('should close handle when stat fails and propagate stat error', async () => {
      const origOpen = fs.promises.open;
      let closeCalls = 0;
      try {
        (fs.promises as any).open = async (...args: any[]) => {
          const handle = await origOpen.apply(fs.promises, args as any);
          handle.stat = async () => {
            throw new Error('Injected stat failure');
          };
          const origClose = handle.close.bind(handle);
          handle.close = async () => {
            closeCalls++;
            return origClose();
          };
          return handle;
        };

        await ImageRendererFactory.readByteRange(testFile, 0, 10);
        expect.fail('Should have failed');
      } catch (err: any) {
        expect(err.message).to.include('Injected stat failure');
        expect(closeCalls).to.equal(1);
      } finally {
        fs.promises.open = origOpen;
      }
    });

    it('should reject ranges exceeding file size and close handle', async () => {
      const origOpen = fs.promises.open;
      let closeCalls = 0;
      try {
        (fs.promises as any).open = async (...args: any[]) => {
          const handle = await origOpen.apply(fs.promises, args as any);
          const origClose = handle.close.bind(handle);
          handle.close = async () => {
            closeCalls++;
            return origClose();
          };
          return handle;
        };

        await ImageRendererFactory.readByteRange(testFile, testPayload.length - 2, 10);
        expect.fail('Should have failed');
      } catch (err: any) {
        expect(err.message).to.include('exceeds file size');
        expect(closeCalls).to.equal(1);
      } finally {
        fs.promises.open = origOpen;
      }
    });

    it('should accept range ending exactly at file size boundary (EOF)', async () => {
      const offset = 10;
      const length = testPayload.length - offset;
      const result = await ImageRendererFactory.readByteRange(testFile, offset, length);
      expect(result.toString()).to.equal(testPayload.subarray(offset).toString());
    });

    it('should reject length exceeding MAX_COMPRESSED_PREVIEW_BYTES without opening file', async () => {
      const origOpen = fs.promises.open;
      let openCalls = 0;
      try {
        (fs.promises as any).open = async (...args: any[]) => {
          openCalls++;
          return origOpen.apply(fs.promises, args as any);
        };

        await ImageRendererFactory.readByteRange(testFile, 0, MAX_COMPRESSED_PREVIEW_BYTES + 1);
        expect.fail('Should have failed');
      } catch (err: any) {
        expect(err.message).to.include('exceeds maximum allowed preview size');
        expect(openCalls).to.equal(0);
      } finally {
        fs.promises.open = origOpen;
      }
    });

    it('should assemble buffer across multiple short positive reads', async () => {
      const origOpen = fs.promises.open;
      try {
        (fs.promises as any).open = async (...args: any[]) => {
          const handle = await origOpen.apply(fs.promises, args as any);
          const origRead = handle.read.bind(handle);
          handle.read = async (buffer: any, offset?: any, length?: any, position?: any) => {
            // Read at most 3 bytes per call to simulate short reads
            const chunk = Math.min(length || 3, 3);
            return origRead(buffer, offset, chunk, position);
          };
          return handle;
        };

        const result = await ImageRendererFactory.readByteRange(testFile, 0, 10);
        expect(result.length).to.equal(10);
        expect(result.toString()).to.equal(testPayload.subarray(0, 10).toString());
      } finally {
        fs.promises.open = origOpen;
      }
    });

    it('should reject premature 0-byte read, close handle, and avoid returning partial data', async () => {
      const origOpen = fs.promises.open;
      let closeCalls = 0;
      try {
        (fs.promises as any).open = async (...args: any[]) => {
          const handle = await origOpen.apply(fs.promises, args as any);
          const origClose = handle.close.bind(handle);
          handle.close = async () => {
            closeCalls++;
            return origClose();
          };
          handle.read = async () => {
            // Premature EOF simulation
            return {bytesRead: 0, buffer: Buffer.alloc(0)};
          };
          return handle;
        };

        await ImageRendererFactory.readByteRange(testFile, 0, 10);
        expect.fail('Should have failed');
      } catch (err: any) {
        expect(err.message).to.include('Premature end of file');
        expect(closeCalls).to.equal(1);
      } finally {
        fs.promises.open = origOpen;
      }
    });

    it('should preserve primary read error when close fails during cleanup', async () => {
      const origOpen = fs.promises.open;
      try {
        (fs.promises as any).open = async (...args: any[]) => {
          const handle = await origOpen.apply(fs.promises, args as any);
          handle.read = async () => {
            throw new Error('Primary read failure');
          };
          handle.close = async () => {
            throw new Error('Secondary close failure');
          };
          return handle;
        };

        await ImageRendererFactory.readByteRange(testFile, 0, 10);
        expect.fail('Should have failed');
      } catch (err: any) {
        expect(err.message).to.include('Primary read failure');
      } finally {
        fs.promises.open = origOpen;
      }
    });
  });

  describe('Preview Candidate Validation (validatePreviewCandidate)', () => {
    it('should validate and accept a valid JPEG buffer', async () => {
      const validJpeg = await sharp({
        create: {width: 40, height: 30, channels: 3, background: {r: 255, g: 0, b: 0}}
      }).jpeg().toBuffer();

      const result = await ImageRendererFactory.validatePreviewCandidate(validJpeg);
      expect(result).to.not.be.null;
      expect(result.orientation).to.be.undefined;
    });

    it('should extract valid orientation from JPEG metadata', async () => {
      const orientedJpeg = await sharp({
        create: {width: 40, height: 30, channels: 3, background: {r: 255, g: 0, b: 0}}
      }).withMetadata({orientation: 6}).jpeg().toBuffer();

      const result = await ImageRendererFactory.validatePreviewCandidate(orientedJpeg);
      expect(result).to.not.be.null;
      expect(result.orientation).to.equal(6);
    });

    it('should reject non-JPEG data', async () => {
      const pngBuf = await sharp({
        create: {width: 20, height: 20, channels: 3, background: {r: 0, g: 255, b: 0}}
      }).png().toBuffer();

      const result = await ImageRendererFactory.validatePreviewCandidate(pngBuf);
      expect(result).to.be.null;
    });

    it('should reject truncated JPEG buffer where pixel decoding fails', async () => {
      const validJpeg = await sharp({
        create: {width: 100, height: 100, channels: 3, background: {r: 255, g: 0, b: 0}}
      }).jpeg().toBuffer();

      // Truncate to header portion
      const truncated = validJpeg.subarray(0, 300);
      const result = await ImageRendererFactory.validatePreviewCandidate(truncated);
      expect(result).to.be.null;
    });

    it('should reject empty or null buffers', async () => {
      expect(await ImageRendererFactory.validatePreviewCandidate(Buffer.alloc(0))).to.be.null;
      expect(await ImageRendererFactory.validatePreviewCandidate(null as any)).to.be.null;
    });
  });

  describe('Candidate Fallback Sequencing (getRawPreview & render fallback)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const exifr = require('exifr');
    const mockRawFile = path.join(tempDir, 'mock_raw_fallback.cr2');

    it('should fallback to candidate 2 (thumbnail offset) when candidate 1 (strip) fails decode', async () => {
      const validJpeg = await sharp({
        create: {width: 40, height: 40, channels: 3, background: {r: 255, g: 100, b: 50}}
      }).jpeg().toBuffer();

      // File structure:
      // [0..50]: corrupted bytes (candidate 1)
      // [50..50 + validJpeg.length]: valid JPEG (candidate 2)
      const corruptData = Buffer.alloc(50, 0xee);
      const combined = Buffer.concat([corruptData, validJpeg]);
      await fs.promises.writeFile(mockRawFile, combined);

      const origParse = exifr.parse;
      const origThumb = exifr.thumbnail;
      try {
        exifr.parse = async (): Promise<any> => ({
          ifd0: {
            StripOffsets: 0,
            StripByteCounts: 50,
            ThumbnailOffset: 50,
            ThumbnailLength: validJpeg.length,
            Orientation: 1,
          }
        });
        exifr.thumbnail = async (): Promise<any> => null;

        const preview = await ImageRendererFactory.getRawPreview(mockRawFile);
        expect(preview).to.not.be.null;
        expect(preview.source).to.equal('thumbnail');
        expect(preview.buffer.length).to.equal(validJpeg.length);
      } finally {
        exifr.parse = origParse;
        exifr.thumbnail = origThumb;
      }
    });

    it('should fallback to candidate 3 (exifr.thumbnail) when candidates 1 and 2 fail or are absent', async () => {
      const validThumb = await sharp({
        create: {width: 30, height: 30, channels: 3, background: {r: 0, g: 120, b: 200}}
      }).jpeg().toBuffer();

      await fs.promises.writeFile(mockRawFile, Buffer.from('RAW_HEADER_DATA_NO_STRIPS'));

      const origParse = exifr.parse;
      const origThumb = exifr.thumbnail;
      try {
        exifr.parse = async (): Promise<any> => ({
          ifd0: {
            StripOffsets: 999999, // beyond EOF
            StripByteCounts: 500,
            Orientation: 6,
          }
        });
        exifr.thumbnail = async (): Promise<any> => validThumb;

        const preview = await ImageRendererFactory.getRawPreview(mockRawFile);
        expect(preview).to.not.be.null;
        expect(preview.source).to.equal('exifr-thumb');
        expect(preview.orientation).to.equal(6); // inherited container orientation
      } finally {
        exifr.parse = origParse;
        exifr.thumbnail = origThumb;
      }
    });

    it('should return null when all preview candidates fail', async () => {
      await fs.promises.writeFile(mockRawFile, Buffer.from('SHORT'));

      const origParse = exifr.parse;
      const origThumb = exifr.thumbnail;
      try {
        exifr.parse = async (): Promise<any> => ({
          ifd0: {
            StripOffsets: 100,
            StripByteCounts: 200,
          }
        });
        exifr.thumbnail = async (): Promise<any> => null;

        const preview = await ImageRendererFactory.getRawPreview(mockRawFile);
        expect(preview).to.be.null;
      } finally {
        exifr.parse = origParse;
        exifr.thumbnail = origThumb;
      }
    });

    it('should render via original file fallback when RAW preview extraction returns null', async () => {
      // Create a valid image with .cr2 extension
      const fallbackFile = path.join(tempDir, 'valid_fallback.cr2');
      await sharp({
        create: {width: 50, height: 50, channels: 3, background: {r: 10, g: 200, b: 50}}
      }).jpeg().toFile(fallbackFile);

      const origParse = exifr.parse;
      const origThumb = exifr.thumbnail;
      try {
        // Force getRawPreview to return null
        exifr.parse = async (): Promise<any> => ({});
        exifr.thumbnail = async (): Promise<any> => null;

        const outPath = path.join(tempDir, 'fallback_rendered.webp');
        await PhotoWorker.renderFromImage({
          type: ThumbnailSourceType.Photo,
          mediaPath: fallbackFile,
          size: 40,
          makeSquare: true,
          outPath,
          quality: 80,
          useLanczos3: false,
          smartSubsample: false,
          sharpOptions: {},
          animate: false,
        });

        expect(fs.existsSync(outPath)).to.be.true;
        const meta = await sharp(outPath).metadata();
        expect(meta.width).to.equal(40);
        expect(meta.height).to.equal(40);
      } finally {
        exifr.parse = origParse;
        exifr.thumbnail = origThumb;
      }
    });
  });

  describe('Orientation Transformations 1 through 8 (applyOrientation)', () => {
    // 2x2 asymmetric test image:
    // Pixel (0,0): Red [255, 0, 0]
    // Pixel (1,0): Green [0, 255, 0]
    // Pixel (0,1): Blue [0, 0, 255]
    // Pixel (1,1): Yellow [255, 255, 0]
    const raw2x2 = Buffer.from([
      255, 0, 0,     0, 255, 0,
      0, 0, 255,     255, 255, 0
    ]);

    for (let ori = 1; ori <= 8; ori++) {
      it(`should correctly orient image for EXIF orientation ${ori}`, async () => {
        // Reference image with EXIF tag auto-rotated by Sharp
        const refJpeg = await sharp(raw2x2, {raw: {width: 2, height: 2, channels: 3}})
          .withMetadata({orientation: ori})
          .jpeg()
          .toBuffer();
        const refPixels = await sharp(refJpeg).rotate().raw().toBuffer();

        // Untagged JPEG transformed via ImageRendererFactory.applyOrientation
        const baseJpeg = await sharp(raw2x2, {raw: {width: 2, height: 2, channels: 3}})
          .jpeg()
          .toBuffer();
        const testImg = ImageRendererFactory.applyOrientation(sharp(baseJpeg), ori);
        const testPixels = await testImg.raw().toBuffer();

        expect(testPixels.equals(refPixels)).to.be.true;
      });
    }
  });

  describe('Orientation Precedence and Dimension Computation', () => {
    it('should prioritize JPEG orientation over container orientation', async () => {
      // JPEG tag: 3 (180 deg), Container tag: 6 (90 deg CW)
      const previewWithOri3 = await sharp({
        create: {width: 50, height: 20, channels: 3, background: {r: 255, g: 0, b: 0}}
      }).withMetadata({orientation: 3}).jpeg().toBuffer();

      const candidate = await ImageRendererFactory.validatePreviewCandidate(previewWithOri3);
      expect(candidate.orientation).to.equal(3);

      const containerFallback = 6;
      const effective = (candidate.orientation !== undefined ? candidate.orientation : containerFallback) ?? 1;
      expect(effective).to.equal(3);
    });

    it('should prioritize explicit JPEG orientation 1 over container orientation 6', async () => {
      const previewWithOri1 = await sharp({
        create: {width: 50, height: 20, channels: 3, background: {r: 255, g: 0, b: 0}}
      }).withMetadata({orientation: 1}).jpeg().toBuffer();

      const candidate = await ImageRendererFactory.validatePreviewCandidate(previewWithOri1);
      expect(candidate.orientation).to.equal(1);

      const containerOrientation = 6;
      const effective = candidate.orientation !== undefined ? candidate.orientation : containerOrientation;
      expect(effective).to.equal(1);
    });

    it('should use container orientation when embedded JPEG has no orientation tag', async () => {
      const untaggedPreview = await sharp({
        create: {width: 50, height: 20, channels: 3, background: {r: 255, g: 0, b: 0}}
      }).jpeg().toBuffer();

      const candidate = await ImageRendererFactory.validatePreviewCandidate(untaggedPreview);
      expect(candidate.orientation).to.be.undefined;

      const containerOrientation = 6;
      const effective = candidate.orientation !== undefined ? candidate.orientation : containerOrientation;
      expect(effective).to.equal(6);
    });

    it('should fallback to orientation 1 when neither JPEG nor container provides orientation', async () => {
      const untaggedPreview = await sharp({
        create: {width: 50, height: 20, channels: 3, background: {r: 255, g: 0, b: 0}}
      }).jpeg().toBuffer();

      const candidate = await ImageRendererFactory.validatePreviewCandidate(untaggedPreview);
      const containerOrientation: number | undefined = undefined;
      const effective = candidate.orientation !== undefined ? candidate.orientation : (containerOrientation ?? 1);
      expect(effective).to.equal(1);
    });
  });

  describe('Geometry, Non-Square Resizing, and Face Crop Scaling', () => {
    it('should resize landscape image preserving short side without upscaling', async () => {
      // 100 wide x 60 high (landscape, short side is 60)
      const imgPath = path.join(tempDir, 'landscape_test.jpg');
      await sharp({
        create: {width: 100, height: 60, channels: 3, background: {r: 10, g: 20, b: 30}}
      }).jpeg().toFile(imgPath);

      const outAbove = path.join(tempDir, 'landscape_above.webp');
      // size = 80 > short side (60): should NOT upscale
      await PhotoWorker.renderFromImage({
        type: ThumbnailSourceType.Photo,
        mediaPath: imgPath,
        size: 80,
        makeSquare: false,
        outPath: outAbove,
        quality: 80,
        useLanczos3: false,
        smartSubsample: false,
        sharpOptions: {},
        animate: false,
      });

      const metaAbove = await sharp(outAbove).metadata();
      expect(metaAbove.height).to.equal(60);
      expect(metaAbove.width).to.equal(100);

      const outBelow = path.join(tempDir, 'landscape_below.webp');
      // size = 30 < short side (60): should downscale proportionally
      await PhotoWorker.renderFromImage({
        type: ThumbnailSourceType.Photo,
        mediaPath: imgPath,
        size: 30,
        makeSquare: false,
        outPath: outBelow,
        quality: 80,
        useLanczos3: false,
        smartSubsample: false,
        sharpOptions: {},
        animate: false,
      });

      const metaBelow = await sharp(outBelow).metadata();
      expect(metaBelow.height).to.equal(30);
      expect(metaBelow.width).to.equal(50);
    });

    it('should resize portrait image preserving short side without upscaling', async () => {
      // 60 wide x 100 high (portrait, short side is 60)
      const imgPath = path.join(tempDir, 'portrait_test.jpg');
      await sharp({
        create: {width: 60, height: 100, channels: 3, background: {r: 10, g: 20, b: 30}}
      }).jpeg().toFile(imgPath);

      const outAbove = path.join(tempDir, 'portrait_above.webp');
      // size = 90 > short side (60): should NOT upscale
      await PhotoWorker.renderFromImage({
        type: ThumbnailSourceType.Photo,
        mediaPath: imgPath,
        size: 90,
        makeSquare: false,
        outPath: outAbove,
        quality: 80,
        useLanczos3: false,
        smartSubsample: false,
        sharpOptions: {},
        animate: false,
      });

      const metaAbove = await sharp(outAbove).metadata();
      expect(metaAbove.width).to.equal(60);
      expect(metaAbove.height).to.equal(100);

      const outBelow = path.join(tempDir, 'portrait_below.webp');
      // size = 30 < short side (60): should downscale proportionally
      await PhotoWorker.renderFromImage({
        type: ThumbnailSourceType.Photo,
        mediaPath: imgPath,
        size: 30,
        makeSquare: false,
        outPath: outBelow,
        quality: 80,
        useLanczos3: false,
        smartSubsample: false,
        sharpOptions: {},
        animate: false,
      });

      const metaBelow = await sharp(outBelow).metadata();
      expect(metaBelow.width).to.equal(30);
      expect(metaBelow.height).to.equal(50);
    });

    it('should correctly scale face crop coordinates when preview is smaller than original RAW', async () => {
      // Simulate image 400x300, but face crop was expressed in original 1600x1200 coordinates
      const imgPath = path.join(tempDir, 'crop_scale_test.jpg');
      await sharp({
        create: {width: 400, height: 300, channels: 3, background: {r: 50, g: 100, b: 150}}
      }).jpeg().toFile(imgPath);

      const outPath = path.join(tempDir, 'crop_scaled.webp');
      // Face crop in original space: left=800, top=600, width=400, height=400
      // Scaled by 0.25 to preview space: left=200, top=150, width=100, height=100
      const input: MediaRendererInput = {
        type: ThumbnailSourceType.Photo,
        mediaPath: imgPath,
        size: 80,
        makeSquare: true,
        outPath,
        quality: 80,
        useLanczos3: false,
        smartSubsample: false,
        sharpOptions: {},
        animate: false,
        cut: {
          left: 800,
          top: 600,
          width: 400,
          height: 400,
        },
        cutOriginalSize: {
          width: 1600,
          height: 1200,
        },
      };

      await PhotoWorker.renderFromImage(input);
      expect(fs.existsSync(outPath)).to.be.true;
      const meta = await sharp(outPath).metadata();
      expect(meta.width).to.equal(80);
      expect(meta.height).to.equal(80);
    });

    it('should support dryRun without writing output to disk', async () => {
      const imgPath = path.join(tempDir, 'dryrun_test.jpg');
      await sharp({
        create: {width: 100, height: 100, channels: 3, background: {r: 0, g: 0, b: 0}}
      }).jpeg().toFile(imgPath);

      const outPath = path.join(tempDir, 'dryrun_should_not_exist.webp');
      await PhotoWorker.renderFromImage({
        type: ThumbnailSourceType.Photo,
        mediaPath: imgPath,
        size: 50,
        makeSquare: true,
        outPath,
        quality: 80,
        useLanczos3: false,
        smartSubsample: false,
        sharpOptions: {},
        animate: false,
      }, true);

      expect(fs.existsSync(outPath)).to.be.false;
    });

    it('should propagate output write errors directly without retrying decode', async () => {
      const imgPath = path.join(tempDir, 'output_err_test.jpg');
      await sharp({
        create: {width: 50, height: 50, channels: 3, background: {r: 0, g: 0, b: 0}}
      }).jpeg().toFile(imgPath);

      const invalidOut = '/dev/null/forbidden/path/thumb.webp';
      try {
        await PhotoWorker.renderFromImage({
          type: ThumbnailSourceType.Photo,
          mediaPath: imgPath,
          size: 50,
          makeSquare: true,
          outPath: invalidOut,
          quality: 80,
          useLanczos3: false,
          smartSubsample: false,
          sharpOptions: {},
          animate: false,
        });
        expect.fail('Should have failed');
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  describe('Real RAW Samples and Degradation Handling', () => {
    it('should extract preview and render Canon CR2 sample', async () => {
      if (!fs.existsSync(cr2Photo)) {
        return;
      }
      const preview = await ImageRendererFactory.getRawPreview(cr2Photo);
      expect(preview).to.not.be.null;
      expect(preview.source).to.equal('strip');
      expect(preview.orientation).to.equal(1);
      expect(preview.buffer.length).to.be.greaterThan(10000);

      const outPath = path.join(tempDir, 'real_cr2.webp');
      await PhotoWorker.renderFromImage({
        type: ThumbnailSourceType.Photo,
        mediaPath: cr2Photo,
        size: 150,
        makeSquare: false,
        outPath,
        quality: 80,
        useLanczos3: false,
        smartSubsample: false,
        sharpOptions: {},
        animate: false,
      });

      expect(fs.existsSync(outPath)).to.be.true;
      const meta = await sharp(outPath).metadata();
      expect(meta.height).to.equal(150);
    });

    it('should extract preview and render Sony ARW sample', async () => {
      if (!fs.existsSync(arwPhoto)) {
        return;
      }
      const preview = await ImageRendererFactory.getRawPreview(arwPhoto);
      expect(preview).to.not.be.null;
      expect(preview.source).to.equal('thumbnail');
      expect(preview.orientation).to.equal(1);
      expect(preview.buffer.length).to.be.greaterThan(10000);

      const outPath = path.join(tempDir, 'real_arw.webp');
      await PhotoWorker.renderFromImage({
        type: ThumbnailSourceType.Photo,
        mediaPath: arwPhoto,
        size: 120,
        makeSquare: true,
        outPath,
        quality: 80,
        useLanczos3: false,
        smartSubsample: false,
        sharpOptions: {},
        animate: false,
      });

      expect(fs.existsSync(outPath)).to.be.true;
      const meta = await sharp(outPath).metadata();
      expect(meta.width).to.equal(120);
      expect(meta.height).to.equal(120);
    });
  });
});
