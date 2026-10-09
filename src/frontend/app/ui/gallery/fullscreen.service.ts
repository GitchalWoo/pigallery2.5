import {Injectable} from '@angular/core';
import {Event} from '../../../../common/event/Event';


type FullScreenDocument = Document & {
  mozFullScreenElement?: Element;
  webkitFullscreenElement?: Element;
  msFullscreenElement?: Element;
  mozCancelFullScreen?: () => void;
  webkitExitFullscreen?: () => void;
  msExitFullscreen?: () => void;
};

@Injectable()
export class FullScreenService {
  OnFullScreenChange = new Event<boolean>();
  private readonly onNativeChange = (): void => {
    this.OnFullScreenChange.trigger(this.isFullScreenEnabled());
  };

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', this.onNativeChange);
      document.addEventListener('webkitfullscreenchange', this.onNativeChange);
      document.addEventListener('mozfullscreenchange', this.onNativeChange);
      document.addEventListener('MSFullscreenChange', this.onNativeChange);
    }
  }

  public destroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', this.onNativeChange);
      document.removeEventListener('webkitfullscreenchange', this.onNativeChange);
      document.removeEventListener('mozfullscreenchange', this.onNativeChange);
      document.removeEventListener('MSFullscreenChange', this.onNativeChange);
    }
  }

  public getFullscreenElement(): Element | null {
    if (typeof document === 'undefined') {
      return null;
    }
    const doc = document as FullScreenDocument;
    return doc.fullscreenElement ||
      doc.mozFullScreenElement ||
      doc.webkitFullscreenElement ||
      doc.msFullscreenElement ||
      null;
  }

  public isFullScreenEnabled(): boolean {
    return !!this.getFullscreenElement();
  }

  public isElementFullScreen(element: Element): boolean {
    if (!element) {
      return false;
    }
    return this.getFullscreenElement() === element;
  }

  public showFullScreen(element: Element): void {
    if (this.isFullScreenEnabled()) {
      return;
    }

    if (element.requestFullscreen) {
      element.requestFullscreen().catch(console.error);
    } else if ((element as unknown as Record<string, () => void>).mozRequestFullScreen) {
      (element as unknown as Record<string, () => void>).mozRequestFullScreen();
    } else if ((element as unknown as Record<string, () => void>).webkitRequestFullscreen) {
      (element as unknown as Record<string, () => void>).webkitRequestFullscreen();
    } else if ((element as unknown as Record<string, () => void>).msRequestFullscreen) {
      (element as unknown as Record<string, () => void>).msRequestFullscreen();
    }
  }

  public exitFullScreen(): void {
    if (!this.isFullScreenEnabled() || typeof document === 'undefined') {
      return;
    }

    const doc = document as FullScreenDocument;
    if (doc.exitFullscreen) {
      doc.exitFullscreen();
    } else if (doc.mozCancelFullScreen) {
      doc.mozCancelFullScreen();
    } else if (doc.webkitExitFullscreen) {
      doc.webkitExitFullscreen();
    } else if (doc.msExitFullscreen) {
      doc.msExitFullscreen();
    }
  }
}

