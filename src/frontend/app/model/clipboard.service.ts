import {Injectable} from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ClipboardService {
  public get isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText;
  }

  public async copy(text: string): Promise<boolean> {
    if (this.isSupported) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('Failed to copy text using navigator.clipboard.writeText:', err);
      }
    }
    return false;
  }
}
