import {logClientBuild} from './client-build-info';

describe('client build identity', () => {
  it('logs the bundle identity and handles source and development builds', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const buildTime = '2026-11-26T12:00:00.000Z';
      logClientBuild({appVersion: 'pigallery2.5@01234567', buildTime, buildCommitHash: '0123456789'});
      logClientBuild({appVersion: 'pigallery2.5@source', buildTime});
      logClientBuild();
      expect(info.mock.calls).toEqual([
        ['PiGallery2.5 client pigallery2.5@01234567, built ' + buildTime + ', commit 0123456789'],
        ['PiGallery2.5 client pigallery2.5@source, built ' + buildTime + ', commit unknown'],
        ['PiGallery2.5 client: dev build'],
      ]);
    } finally {
      info.mockRestore();
    }
  });
});
