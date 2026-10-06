import {MediaIcon} from './MediaIcon';
import {type MediaDTO} from '../../../../common/entities/MediaDTO';
import {Config} from '../../../../common/config/public/Config';

describe('MediaIcon', () => {
  const createMockMedia = (name = 'test.jpg'): MediaDTO => ({
    id: 1,
    name,
    directory: {name: 'vacation', path: '/2026'},
    metadata: {
      size: {width: 4000, height: 3000},
      creationDate: 1700000000000,
      fileSize: 1024 * 1024,
    },
    missingThumbnails: 0,
  });

  describe('getMediaSize', () => {
    it('should select ceiling size rather than closest size for high-DPI/large viewports', () => {
      const mediaIcon = new MediaIcon(createMockMedia());
      // Default thumbnailSizes are [320, 540, 1080, 2160]
      // A viewport dimension of 1400 is closer to 1080 (|1400-1080|=320) than 2160 (|1400-2160|=760).
      // Closest-match would pick 1080 (downscaled/blurry), but ceiling-match must pick 2160 (>= 1400).
      expect(mediaIcon.getMediaSize(1400, 900)).toBe(2160);
      expect(mediaIcon.getMediaSize(900, 1400)).toBe(2160);
    });

    it('should return exact match when longer edge matches a thumbnail size', () => {
      const mediaIcon = new MediaIcon(createMockMedia());
      expect(mediaIcon.getMediaSize(1080, 720)).toBe(1080);
      expect(mediaIcon.getMediaSize(540, 360)).toBe(540);
      expect(mediaIcon.getMediaSize(320, 200)).toBe(320);
    });

    it('should return smallest thumbnail size when dimensions are below the smallest size', () => {
      const mediaIcon = new MediaIcon(createMockMedia());
      expect(mediaIcon.getMediaSize(100, 100)).toBe(320);
      expect(mediaIcon.getMediaSize(0, 0)).toBe(320);
    });

    it('should return largest thumbnail size when dimensions exceed the largest size', () => {
      const mediaIcon = new MediaIcon(createMockMedia());
      expect(mediaIcon.getMediaSize(3840, 2160)).toBe(2160);
      expect(mediaIcon.getMediaSize(4000, 3000)).toBe(2160);
    });

    it('should use the longer edge regardless of portrait or landscape orientation', () => {
      const mediaIcon = new MediaIcon(createMockMedia());
      // Landscape: width (800) > height (600). Ceiling for 800 in [320, 540, 1080, 2160] is 1080.
      expect(mediaIcon.getMediaSize(800, 600)).toBe(1080);
      // Portrait: height (800) > width (600). Ceiling for 800 in [320, 540, 1080, 2160] is 1080.
      expect(mediaIcon.getMediaSize(600, 800)).toBe(1080);
    });
  });

  describe('getBestSizedMediaPath', () => {
    it('should construct URL with the ceiling-matched preview size', () => {
      const mediaIcon = new MediaIcon(createMockMedia('photo.jpg'));
      const path = mediaIcon.getBestSizedMediaPath(1400, 900);
      expect(path).toContain('/gallery/content/');
      expect(path).toContain('photo.jpg');
      expect(path).toMatch(/\/2160$/);
    });
  });

  describe('sortedThumbnailSizes', () => {
    it('should not mutate Config.Media.Photo.thumbnailSizes in place', () => {
      expect(MediaIcon.sortedThumbnailSizes).toEqual(
        [...Config.Media.Photo.thumbnailSizes].sort((a, b) => a - b)
      );
    });
  });
});

