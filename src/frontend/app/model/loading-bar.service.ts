import {Injectable, signal, computed} from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LoadingBarService {
  private readonly activeRequests = signal<number>(0);
  public readonly isLoading = computed(() => this.activeRequests() > 0);

  public start(): void {
    this.activeRequests.update((count) => count + 1);
  }

  public complete(): void {
    this.activeRequests.update((count) => Math.max(0, count - 1));
  }

  public stop(): void {
    this.activeRequests.set(0);
  }
}
