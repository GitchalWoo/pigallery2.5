import {FullScreenService} from './fullscreen.service';

describe('FullScreenService', () => {
  let service: FullScreenService;

  beforeEach(() => {
    service = new FullScreenService();
  });

  afterEach(() => {
    service.destroy();
  });

  it('should detect fullscreen enabled when document.fullscreenElement is set', () => {
    expect(service.isFullScreenEnabled()).toBe(false);

    const div = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', {
      value: div,
      configurable: true,
      writable: true,
    });

    expect(service.isFullScreenEnabled()).toBe(true);
    expect(service.isElementFullScreen(div)).toBe(true);

    const otherDiv = document.createElement('div');
    expect(service.isElementFullScreen(otherDiv)).toBe(false);

    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
      writable: true,
    });
    expect(service.isFullScreenEnabled()).toBe(false);
  });

  it('should trigger OnFullScreenChange when native fullscreenchange fires', () => {
    let firedWith: boolean | null = null;
    service.OnFullScreenChange.on((val) => {
      firedWith = val;
    });

    const div = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', {
      value: div,
      configurable: true,
      writable: true,
    });

    document.dispatchEvent(new Event('fullscreenchange'));
    expect(firedWith).toBe(true);

    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
      writable: true,
    });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(firedWith).toBe(false);
  });
});
