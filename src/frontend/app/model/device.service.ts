import {Injectable} from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class DeviceService {
  public isDesktop(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return true;
    }
    // Desktop devices typically have (pointer: fine) and (hover: hover), whereas touch/mobile devices match (pointer: coarse).
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches ||
      !window.matchMedia('(pointer: coarse)').matches;
  }

  public isMobile(): boolean {
    return !this.isDesktop();
  }
}
