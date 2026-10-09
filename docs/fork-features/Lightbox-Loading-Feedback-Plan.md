# Lightbox Loading Bar & Navigation Feedback Plan

## Overview

This feature provides immediate and continuous visual feedback in the lightbox when viewing and navigating photos:
1. **Continuous loading feedback**: The top loading bar (`TopLoadingBarComponent`) is shown while the currently selected photo's higher-resolution image downloads and decodes, keeping the available preview visible without blanking.
2. **Immediate navigation feedback**: Instant preview swap to the target photo's thumbnail/caption, tactile `:active` state on navigation controls, and rapid-click queuing so fast navigation (A → B → C) advances without lost clicks or frozen frames.
3. **Robust lifecycle & ownership guards**: Ownership-safe loading tokens (`LoadingBarService.begin()`), monotonic request identity, complete decoupling of photo loading from video/live-photo events, and native fullscreen support.

---

## Architecture & Phasing

### Phase 1: Shared Loading-Bar Ownership & Presentation
- **Ownership-safe tracking (`LoadingBarService.begin()`)**:
  Exposes an additive, idempotent completion function:
  ```ts
  public begin(): () => void {
    this.start();
    let completed = false;
    return () => {
      if (completed) return;
      completed = true;
      this.complete();
    };
  }
  ```
- **Reusable presentation (`TopLoadingBarComponent`)**:
  - Standalone component encapsulating the indeterminate CSS animation.
  - 150 ms reveal delay via CSS (`loading-bar-reveal`) to suppress flicker for instant/cached loads.
  - `prefers-reduced-motion` support (static bar).
  - ARIA `progressbar` role with accessible, localized label.
- **Refactor `FrameComponent`**:
  Replaces raw `.top-loading-bar` markup and CSS with `<app-top-loading-bar>`.

### Phase 2: Lightbox Integration, Lifecycle Guards & Rapid Navigation
- **Decouple Photo and Video Callbacks**:
  - Separate `(loadstart)` and `(error)` handlers on `<video>` elements (`onVideoLoadStart()`, `onVideoError()`, `onLiveVideoError()`) so video events cannot release photo requests or trigger `img.decode()`.
- **Centralized & Guarded Photo Loading (`MediaLightboxGalleryComponent`)**:
  - Monotonic `requestId` to protect against stale async callbacks (`decode()`, `load`, `error`).
  - Staged/pending image decoding on zoom upgrade to preserve the screen-sized preview without blanking.
  - Explicit cancellation (`cancelActiveRequest()`) on photo change, close start, and destruction.
- **Native Fullscreen Support**:
  - Listen to DOM `fullscreenchange` in `FullScreenService` / `GalleryLightboxComponent`.
  - Render `<app-top-loading-bar>` inside `#root` when `#root` is the native fullscreen element.
  - Ensure only one loading bar is visible/announced.
- **Rapid Navigation & Immediate Feedback**:
  - Track pending target photo index in `GalleryLightboxComponent` to eliminate the async router race condition where rapid clicks drop inputs.
  - Immediate preview swap to the next thumbnail and immediate title/caption update.
  - `:active` press state on navigation arrows in `controls.lightbox.gallery.component.css`.

---

## Test Scenarios

| Area | Scenario | Expected Result |
|---|---|---|
| **Loading Service** | `begin()` increments counter | `isLoading()` becomes true |
| **Loading Service** | Calling token completes request | Counter decrements, `isLoading()` false |
| **Loading Service** | Calling token multiple times | Idempotent; cannot decrement below zero or clear another request |
| **Loading Service** | Concurrent tokens | Counter correctly aggregates active requests |
| **Media Component** | Initial photo load | Acquires loading token; preview remains visible |
| **Media Component** | Decode pending | Token remains active until `decode()` settles |
| **Media Component** | Cached image | Completes correctly without waiting for missed events |
| **Media Component** | Zoom upgrade | Preserves screen-sized preview; acquires token for high-res upgrade |
| **Media Component** | Rapid navigation (A → B → C) | Stale callbacks from A & B cannot update readiness or clear C's token |
| **Media Component** | Close during download/decode | In-flight token ends immediately; no animation blanking |
| **Media Component** | Video/Live photo events | Never finishes or affects photo loading tokens |
| **Controls / Nav** | Rapid double/triple clicks | Navigation queue advances target index (+1, +2) without dropping clicks |
| **Controls / Nav** | Control `:active` feedback | Visual press confirmation on arrow buttons |
| **Fullscreen** | Native fullscreen entry/exit | Top bar displays inside fullscreen `#root`; single bar visible |
