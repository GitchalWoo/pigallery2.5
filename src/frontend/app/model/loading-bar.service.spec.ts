import {TestBed} from '@angular/core/testing';
import {LoadingBarService} from './loading-bar.service';

describe('LoadingBarService', () => {
  let service: LoadingBarService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LoadingBarService]
    });
    service = TestBed.inject(LoadingBarService);
  });

  it('should be created with initial idle state', () => {
    expect(service).toBeTruthy();
    expect(service.isLoading()).toBe(false);
  });

  it('should track manual start and complete calls', () => {
    service.start();
    expect(service.isLoading()).toBe(true);

    service.complete();
    expect(service.isLoading()).toBe(false);
  });

  it('should not decrement below zero on extra complete calls', () => {
    service.complete();
    expect(service.isLoading()).toBe(false);
  });

  describe('begin() ownership token', () => {
    it('should increment active requests on begin() and decrement on done()', () => {
      const done = service.begin();
      expect(service.isLoading()).toBe(true);

      done();
      expect(service.isLoading()).toBe(false);
    });

    it('should be idempotent: calling done() multiple times only completes once', () => {
      const done = service.begin();
      expect(service.isLoading()).toBe(true);

      done();
      expect(service.isLoading()).toBe(false);

      done();
      expect(service.isLoading()).toBe(false);
    });

    it('should safely manage multiple concurrent tokens without interfering', () => {
      const doneA = service.begin();
      const doneB = service.begin();
      expect(service.isLoading()).toBe(true);

      doneA();
      expect(service.isLoading()).toBe(true); // doneB still active

      // calling doneA again must not clear doneB
      doneA();
      expect(service.isLoading()).toBe(true);

      doneB();
      expect(service.isLoading()).toBe(false);

      // extra calls from either token are harmless
      doneB();
      expect(service.isLoading()).toBe(false);
    });

    it('should not underflow if stop() was called before token completes', () => {
      const done = service.begin();
      expect(service.isLoading()).toBe(true);

      service.stop();
      expect(service.isLoading()).toBe(false);

      done();
      expect(service.isLoading()).toBe(false);
    });
  });
});

