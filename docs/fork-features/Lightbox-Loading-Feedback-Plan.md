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

---

## Implementation & Verification Status

### Phase 1 (Completed in commit `9175d0b9`)
- Implemented `LoadingBarService.begin()` returning idempotent cancellation / completion closures.
- Created `TopLoadingBarComponent` with 150 ms reveal delay (`loading-bar-reveal`), indeterminate keyframe animation, `prefers-reduced-motion` static bar, and accessibility labels (`role="progressbar"`).
- Refactored `FrameComponent` to consume `<app-top-loading-bar>`.
- Verified with unit tests in `loading-bar.service.spec.ts` and `top-loading-bar.component.spec.ts`.

### Phase 2 (Completed in commit `8dfa8eb5`)
- Added native `fullscreenchange` DOM event listeners, `isElementFullScreen()`, and `getFullscreenElement()` to `FullScreenService`.
- Decoupled video events from photo callbacks in `MediaLightboxGalleryComponent` (`onVideoLoadStart()`, `onVideoError()`, `onLiveVideoError()`).
- Added monotonic `currentRequestId` request identity, lifecycle cancellation (`cancelActiveRequest()`), staged zoom upgrade decoding without blanking, and accessible `.high-res-error-badge`.
- Implemented navigation target queuing (`pendingPhotoIndex`) in `GalleryLightboxComponent` to eliminate dropped rapid clicks, immediate title updates, and native fullscreen top bar rendering.
- Added tactile `:active` state to `.navigation-arrow` in `controls.lightbox.gallery.component.css`.
- Verified with unit tests in `media.lightbox.gallery.component.spec.ts`, `lightbox.gallery.component.spec.ts`, and `fullscreen.service.spec.ts`.

### Phase 3: Lightbox Opening Transition Resilience & Controls Display Fix
- **Root Cause Analysis (Missing Controls on Initial Click in CR2 / Raw Folders)**:
  - When opening the lightbox, `status` starts as `LightboxStates.Opening`, hiding `<app-lightbox-controls>` (`@if (isOpen())`). The transition to `LightboxStates.Open` depends on `animatePhoto().onDone(...)`.
  - When entering a folder with raw/CR2 files, background thumbnail generation and grid chunk rendering cause `this.source.changes` (`QueryList.changes`) to fire shortly after opening begins.
  - Previously, `this.source.changes` unconditionally called `this.updateActivePhoto(this.activePhotoId)` with default `resize = true`, starting a competing animation on the same element.
  - In `runAnimation`, `target.getAnimations().forEach(a => a.cancel())` cancelled the in-flight opening animation. However, `anim.oncancel` was not wired, so the cancelled opening animation never fired `finish()` or its `onDone` callback.
  - This left `status` permanently stuck in `LightboxStates.Opening` (`animating = true`), preventing controls from ever rendering and blocking high-res image loading (`[loadMedia]="!animating"`).
  - Additionally, if CR2 photos had missing or zero metadata dimensions prior to full extraction, `calcLightBoxPhotoDimension` produced `NaN`, turning into invalid `'NaNpx'` CSS values.
- **Resolution**:
  1. **`anim.oncancel` & 350 ms safety fallback in `runAnimation`**: Wired `anim.oncancel = finish;` so cancelled animations still settle styles and invoke callbacks. Added a 350 ms fallback timer ensuring animations never hang indefinitely under heavy CPU/thread load or dropped frames.
  2. **Opening state safety timer**: Added `openingTimer` (350 ms) in `GalleryLightboxComponent.showLightbox()` to guarantee automatic promotion from `Opening` to `Open` even under unexpected browser animation stalls.
  3. **Guard `source.changes` during transitions**: Updated `this.updateActivePhoto` in `setSource` to pass `resize = (this.status === LightboxStates.Open)`, preventing competing animations while opening or closing.
  4. **Promote on rapid navigation**: If `showPhoto` is invoked with `resize = true` while opening, promote status to `Open` immediately.
  5. **Harden dimensions & `NaN` protection**: `DimensionUtils.toString()` checks `Number.isFinite()` falling back to `0px`. `calcLightBoxPhotoDimension()` guards against missing metadata and zero width/height.
- **Verification**:
  - Full test suite passed (23 test suites, 218 tests passing, 0 failures).
  - English build completed successfully with initial chunks within budget (1.52 MB).

### Phase 4: Request Isolation & Upgrade Identity Guards (PR Review Fixes)
- **Root Cause Analysis (PR Review Findings)**:
  1. *Preview completion cancelling original upgrade*: `onImageLoad()` in `MediaLightboxGalleryComponent` read `this.activeRequest`. If zooming occurred before the base preview finished downloading, `activeRequest` pointed to the upgrade request. When `<img #image>` fired `(load)`, it completed the upgrade request prematurely and set `activeRequest = null`, preventing `upgradeImage` from ever being promoted.
  2. *Old upgrade failure clearing newer request*: In `onUpgradeImageLoad()`, `upgradeImg.decode().catch(...)` called `onUpgradeImageError()` without verifying the captured request ID. If the user navigated to another photo while the decode was pending, the rejection would fail and clear the new photo's active request.
  3. *Test coverage gap*: In the stale-completion test, `onImageLoad()` was never invoked while photo 1 was active, so `decode()` was never attached to component logic before navigating.
- **Resolution**:
  1. **Separate `baseRequest` and `upgradeRequest` records**: Tracked distinct request records (`baseRequest` for `<img #image>` and `upgradeRequest` for `upgradeImage`).
  2. **Decoupled event binding**:
     - `onImageLoad()` and `onImageError()` bind strictly to `baseRequest`. If `baseRequest` was already superseded/completed by zoom, `onImageLoad()` marks the preview loaded without touching `upgradeRequest`.
     - `onUpgradeImageLoad()` and `onUpgradeImageError()` receive and strictly validate `requestId`, ignoring rejections or completions from superseded requests after navigation.
  3. **Comprehensive test coverage**:
     - Fixed the stale-completion test to invoke `onImageLoad()` and start `img.decode()` before navigating.
     - Added unit tests verifying preview load completion during an in-flight zoom upgrade does not cancel the upgrade.
     - Added unit tests verifying that an old upgrade decode failure after navigation does not fail the new photo's request.
- **Verification**:
  - Full test suite passed (23 test suites, 220 tests passing, 0 failures).
  - English build completed successfully with initial chunks within budget (1.52 MB).

### Phase 5: i18n Localization & Multi-Language Build Verification
- **Issue**:
  - Multi-language production builds (`npm run build`) produced warnings across all 15 non-English locales for missing translations:
    - `No translation found for "5358156663374754143"` (`Higher-resolution image could not be loaded.`)
    - `No translation found for "7619560701830330401"` (`Loading`)
- **Resolution**:
  - Extracted updated messages from source templates (`node scripts/translations.mjs extract`).
  - Merged new translation units into all 16 locale translation files (`src/frontend/translate/messages.*.xlf`) using `npm run merge-new-translation`.
- **Verification**:
  - Executed full multi-language build (`npm run build`) compiling all 16 locales; zero missing translation warnings emitted.
  - All 220 frontend unit tests passing (`npm run test-frontend`).

