# Thumbnail loading feedback and geometry: worker handoff

Prepared 2026-10-09 from the current source and findings 1–2 in
[Frontend-Audit.md](Frontend-Audit.md). Status: implemented on branch
`fix/thumbnail-feedback-geometry`; unit tests and English build passing;
awaiting manual browser validation.

Implement the two findings as two reviewable changes, with their regression tests.
Preserve the opaque tile background, explicit tile dimensions, cached-image
handling, decode/reveal behavior and existing change-detection configuration.
Do not include grid reconciliation, virtualization, IntersectionObserver adoption,
hover redesign or other audit findings in this work.

## 1. Restore loading feedback throughout the displayed image lifecycle

### Files and confirmed behavior

- `src/frontend/app/ui/gallery/grid/photo/photo.grid.gallery.component.{ts,html,css}`:
  the placeholder exists while `!loaded`, but animates only when
  `thumbnail.loading` is true. The displayed `<img>` has no error handler.
- `src/frontend/app/ui/gallery/grid/photo/loading/loading.photo.grid.gallery.component.{ts,html,css}`:
  the nine cubes use the same `--item-background` color as the tile beneath them.
- `src/frontend/app/ui/gallery/thumbnailManager.service.ts` and
  `thumbnailLoader.service.ts`: `Available` describes thumbnail availability;
  `loading` describes an active queue request. Neither means the displayed image
  is decoded and ready. Read these services, but retain their queue semantics.

### Intended behavior

Use the displayed tile's readiness as the loading UI contract. Keep `loaded` as
the reveal flag, and represent displayed-image failure separately from queue
failure. Avoid introducing a second, conflicting service-level loading state.

| State | Tile feedback |
| --- | --- |
| Initial wait shorter than 150 ms | Stable opaque background; no visible animated indicator |
| Queued, actively generating, downloading an available thumbnail, or awaiting decode after 150 ms | Contrasting animated indicator |
| Displayed image ready | Remove placeholder and reveal image through the existing opacity behavior |
| Generation or displayed-image failure, with no usable image | Immediate static warning; no continuing loading animation |
| Reduced motion enabled | Same delayed feedback, but a visible static indicator |
| Usable replacement thumbnail already displayed while a better thumbnail loads | Keep the usable preview visible; do not reintroduce a loading overlay |

150 ms is an initial implementation value, not a measured optimum. Check it with
warm-cache and throttled browser runs. Do not add a minimum display duration that
delays revealing a ready image.

### Implementation steps

1. Keep `.photo-container`'s background and reserved dimensions. Retain the cube
   structure for this scoped fix; changing the indicator design is unnecessary.
   Give cubes an explicit contrasting foreground token/color, verified against
   the actual tile background in both themes. Do not assume a theme text color
   automatically contrasts with the currently fixed gray tile background.
2. Drive animation from pending displayed-image state, independent of
   `thumbnail.loading`. Keep the placeholder mounted throughout the wait so queue
   transitions cannot restart its display delay. Suppress animation on errors.
3. Prefer a CSS-only 150 ms reveal delay on the non-error indicator wrapper,
   separate from the cube animation. This avoids one JavaScript timer per tile.
   Keep the background visible from the first frame. The warning branch must
   bypass the delay. Under `prefers-reduced-motion: reduce`, disable cube motion
   without leaving the indicator permanently invisible or scaled to zero.
4. Add an `<img>` error handler and component-local error state. Combine that
   state with `thumbnail.Error` for the placeholder warning. Clear local failure
   when a new source is attempted; do not mutate the service's protected error
   state or introduce retries in this change.
5. Preserve the cached `complete && naturalWidth > 0` path and the decode path.
   Guard asynchronous decode completion against component destruction, a changed
   image/source, and a subsequent image error. A decode rejection alone must not
   hide an otherwise usable image: retain the existing fallback when the current
   image is valid. A failed image must not be marked loaded by a stale completion.
6. Preserve replacement-thumbnail behavior explicitly. A replacement success
   must not be covered merely because full-size generation is pending or fails.
   If a later source fails, ensure the result is either a retained usable preview
   or a visible warning, never a broken image marked ready. Keep any source
   tracking local to this component and mark asynchronous state changes for check.

### Focused regression coverage

Extend `photo.grid.gallery.component.spec.ts`; add loading-component tests only
where they cover behavior not already exercised through the parent.

- Queue waiting and active generation both request feedback while not loaded.
- `Available=true`, `loading=false`, `loaded=false` still requests feedback.
- A deferred `decode()` promise keeps the placeholder until readiness; completion
  removes it. Cover valid decode rejection fallback and cached completion.
- Both queue error and `<img>` error show the static warning.
- Destroyed components and stale decode completions cannot update readiness.
- Replacement-to-final-source success/failure cannot restart a blank placeholder
  over a usable preview or leave an invisible failed tile.
- Keep existing Live Photo badge tests passing. Adjust the existing synchronous
  `onImageLoad()` test if using an explicit decode stub; use native async/await.

CSS delay, contrast, reduced motion and absence of flicker require browser checks;
JSDOM assertions cannot establish their visual correctness.

## 2. Make visibility and lightbox geometry use explicit coordinate systems

### Files and confirmed behavior

- `photo.grid.gallery.component.ts`: `isInView()` compares document scroll with
  parent-relative `offsetTop`; `getDimension()` reads the image's offset parent's
  offsets and combines them with untransformed image dimensions.
- `src/frontend/app/ui/gallery/lightbox/lightbox.gallery.component.ts`:
  `showLightbox()` and `hideLightbox()` subtract only `PageHelper.ScrollY`.
  `updateActivePhoto()` uses document coordinates for scroll-to-photo behavior.
- `src/frontend/app/ui/gallery/lightbox/LightboxSource.ts` and
  `src/frontend/app/ui/timeline/timeline-lightbox.source.ts` forward tile geometry.
  Their shared animation target contract must remain consistent.

### Geometry decisions

- Visibility uses a viewport rectangle from the photo container.
- `getDimension()` and `LightboxSource.animationTarget()` return document-space
  coordinates, with dimensions in CSS pixels.
- Lightbox animation keyframes use viewport-space coordinates.
- Animation bounds include the current hover scale. Measure all four values from
  the same rectangle, so transformed positions are never mixed with untransformed
  dimensions. Opening starts from the currently visible tile; closing measures
  the target again at that time.

### Implementation steps

1. Replace the offset calculation in `isInView()` with one
   `container.nativeElement.getBoundingClientRect()` read. Treat a positive-size
   rectangle as visible when it overlaps the viewport:
   `bottom > 0 && top < innerHeight && right > 0 && left < innerWidth`.
   Edge-only contact is not overlap. Preserve the existing priority update guard
   in `onScroll()` and the existing scroll scheduling/configuration behavior.
2. In `getDimension()`, measure the image rectangle when it has usable dimensions;
   otherwise use the reserved container rectangle. A tile may be opened while
   its `<img>` does not yet exist. Return
   `{top: rect.top + PageHelper.ScrollY, left: rect.left + PageHelper.ScrollX,
   width: rect.width, height: rect.height}`. Retain a defensive zero-size fallback
   only when neither element has usable geometry, rather than depending on
   `offsetParent` existence.
3. Document the document-space contract on `animationTarget()`. Do not label all
   `Dimension` objects as document-space: lightbox animation dimensions also use
   this interface and have a different coordinate system.
4. Convert document targets to viewport coordinates in both opening and closing:
   subtract **both** scroll offsets. Prefer one small shared conversion method
   returning a new object so source-owned rectangles cannot be mutated.
5. Fix the no-target fallback in `getGridDimension()` to include `ScrollX` as well
   as `ScrollY`, keeping its zero-size animation origin at the viewport center.
   Preserve the document coordinates used by `updateActivePhoto()` for scrolling.
   Review opening order: any scroll-to-target work must happen before the final
   viewport target is measured/converted, or the animation can use stale offsets.
6. Check gallery and timeline source consumers together. Do not cache rectangles
   across scrolling, relayout or lightbox sessions; close to the current target,
   including after lightbox next/previous navigation.

### Focused regression coverage

Stub `getBoundingClientRect()` in JSDOM; its native layout is not meaningful.

- Partially visible, fully offscreen and exact-edge rectangles on each axis;
  zero-size rectangles; later rows whose `offsetTop` is deliberately misleading.
- Visible-to-hidden transitions update `thumbnail.Visible` correctly without
  repeated writes when visibility has not changed.
- Nonzero X/Y scroll: viewport rectangle `{top: 120, left: 80, width: 196,
  height: 147}` with scroll `{x: 30, y: 900}` becomes document coordinates
  `{top: 1020, left: 110, width: 196, height: 147}`. Opening/closing must convert
  back to the original rectangle, preserving fractional values and scaled size.
- Pending tile without `<img>` uses the container rectangle.
- Extend `lightbox.gallery.component.spec.ts` for opening, closing, changed target
  positions, scroll-to-target ordering, and a missing animation target at nonzero
  scroll. Verify conversion does not mutate the source's target object.

## Validation and acceptance

Run commands with Node 24, prefixing each shell with
`source ~/.nvm/nvm.sh && nvm use >/dev/null &&`:

```bash
npm run test-frontend -- --include='src/frontend/app/ui/gallery/grid/**/*.spec.ts' --include='src/frontend/app/ui/gallery/lightbox/**/*.spec.ts' --include='src/frontend/app/ui/timeline/**/*.spec.ts'
npx tsc -p src/frontend/tsconfig.spec.json --noEmit
npm run build-en
```

Start the built app with `npm start -- --Server-port=8081` (use 8082 if occupied).
Use a visible browser tab and an isolated thumbnail fixture when cold generation
requires cache changes; do not delete the user's thumbnail cache.

| Browser scenario | Acceptance criterion |
| --- | --- |
| Warm cache, repeated navigation | No indicator flash for images ready before the delay; no blank frame introduced |
| Cold cache with pre-generated thumbnails, throttled requests | Feedback stays visible until the displayed image is ready |
| Missing thumbnails and saturated generation queue | Feedback covers both queued and active requests |
| Delayed decode; generation/download failures | Readiness waits for decode; failures stop animation and show a warning |
| Light/dark themes and reduced motion | Indicator remains distinguishable; reduced motion uses static feedback |
| Later rows, grouped headers/blogs, timeline rail, nonzero scroll | Correct visible-tile prioritization and lightbox origin/destination |
| Hover scale, opening/closing, next/previous to another row | No geometry jump caused by mixed coordinates or dimensions |
| Resize and in-app Back from a nonzero scroll position | No new layout shift or loss of restored scroll |

Verify actual transition frames in Chromium and Firefox when available, since
the earlier anti-flicker work explicitly addressed Firefox. Record unavailable
browser coverage rather than claiming it passed. Existing resize-driven tile
recreation belongs to audit finding 3; distinguish that behavior from regressions
introduced here.

Deliver the scoped source changes, focused tests, test/build results and browser
observations. Update findings 1–2 in `Frontend-Audit.md` with implementation and
validation status only after the corresponding work is complete. Do not mark
visual acceptance complete on the strength of JSDOM tests alone.

## Implementation status (2026-10-09)

Implemented on branch `fix/thumbnail-feedback-geometry`:

1. **Loading feedback lifecycle**:
   - Added contrasting foreground token `--item-loading-indicator: #555555;` in `styles.css` (4.15:1 contrast against `#bbbbbb`).
   - Updated `.sk-cube` and `.static` in `loading.photo.grid.gallery.component.css` to use `var(--item-loading-indicator, #555555)`.
   - Added 150 ms CSS reveal delay via `animation: revealIndicator 0s linear 150ms forwards` on `.sk-cube-grid` with `opacity: 0` initial state. Static warning bypasses the delay.
   - Added `@media (prefers-reduced-motion: reduce)` rule presenting static 3x3 grid without scaling motion.
   - Added `(error)="onImageError()"` and component-local `imageError` state in `GalleryPhotoComponent`. Reset error when `thumbnail.OnLoad` receives a new source.
   - Guarded `onImageLoad()` decode path against component destruction, source changes, and errors while preserving fallback for valid images upon decode rejection.
   - Preserved replacement preview: an already loaded preview (`loaded = true`) is never re-covered with a placeholder on queue errors.

2. **Visibility and coordinate geometry**:
   - Replaced offset calculations in `isInView()` with `container.nativeElement.getBoundingClientRect()`, requiring positive overlap on both axes.
   - Replaced `offsetParent` logic in `getDimension()` with `getBoundingClientRect()` from imageRef (fallback to container) plus `PageHelper.ScrollX` and `PageHelper.ScrollY`, returning document-space coordinates.
   - Documented document-space contract on `LightboxSource.animationTarget()`.
   - Added `toViewportDimension()` helper in `GalleryLightboxComponent`, subtracting both `PageHelper.ScrollX` and `PageHelper.ScrollY` and returning new objects.
   - Updated `getGridDimension()` fallback to center zero-size origins on the viewport using both `ScrollX` and `ScrollY`.
   - Reordered `showLightbox()` to execute `showPhoto()` / scroll adjustment before measuring and converting opening viewport geometry.

3. **Automated verification**:
   - `photo.grid.gallery.component.spec.ts`: 23 tests passing (loading state, decode lifecycle, error handling, replacement preservation, `isInView()`, and `getDimension()`).
   - `lightbox.gallery.component.spec.ts`: 20 tests passing (coordinate conversion, source immutability, zero-target fallback centering, and scroll-to-target opening ordering).
   - Full suite across grid, lightbox, and timeline: 89/89 tests passing.
   - TypeScript spec check: `npx tsc -p src/frontend/tsconfig.spec.json --noEmit` clean (0 errors).
   - English build: `npm run build-en` completed successfully (1.52 MB initial bundle).

