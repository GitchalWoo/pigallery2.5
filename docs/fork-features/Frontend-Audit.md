# Frontend HTML, CSS and rendering audit

Date: 2026-10-09. Status: findings and recommendations; no application changes.

## Scope and conclusion

Static review of gallery grid/photo/loading, lightbox, directory/album/face cards,
timeline, thumbnail services and page helpers, plus pattern searches across the
frontend's 55 HTML and 54 CSS files. This is not an exhaustive review of every
settings template. TypeScript is authoritative; generated JavaScript was not
treated as a separate implementation.

The frontend already uses modern Angular block templates, standalone components,
CSS variables, flex layouts and native animation APIs. The main opportunities are
correct geometry, preserving rendered components, reducing repeated template work,
and simplifying loading/hover UI. Removing legacy prefixes is useful maintenance,
but should not be presented as a major performance improvement.

No browser profiling or tests were run for this static audit. Performance benefits
below are hypotheses to measure, not benchmark results. Visual symptoms still need
browser reproduction, especially with scrolling, grouped photos and cached images.

## Findings, in recommended priority order

### 1. High: restore visible thumbnail loading feedback without reintroducing flicker

Sources: `src/frontend/app/ui/gallery/grid/photo/photo.grid.gallery.component.html:3`,
`photo.grid.gallery.component.css:70`;
`src/frontend/app/ui/gallery/grid/photo/loading/loading.photo.grid.gallery.component.css:29`;
`src/frontend/app/ui/gallery/thumbnailManager.service.ts` (`Thumbnail.load()`);
`src/frontend/app/ui/gallery/thumbnailLoader.service.ts` (`run()`).

**Cause identified in history:** commit `fc59808490e11b668605a841345d0c08081b5fa6`
("eliminate grid thumbnail flickering, loading churn, and Firefox transition
 delays") added `background-color: var(--item-background)` to `.photo-container`.
The nine loading cubes already use that exact color. Their animation shrinks them
from full size to zero, exposing the background beneath. With the new matching
background, shrinking cubes expose an identical color: the animation can still
run, but its visual contrast is gone. The code is a CSS cube animation, not a GIF;
the loading component and its keyframes were not removed by that commit.

**A separate state limitation:** the placeholder is now mounted while `!loaded`,
but `[animate]="thumbnail.loading"` reflects only an active request through the
thumbnail generation queue. These are different states:

| State | Placeholder | Cube animation enabled |
| --- | --- | --- |
| Missing thumbnail waiting in the queue | Present | No |
| Missing thumbnail request actively running | Present | Yes, but masked by matching background |
| Thumbnail marked available on the server, browser still downloading it | Present | No |
| Generation request finished, displayed image still loading/decoding | Present | No |
| Displayed image ready (`loaded === true`) | Removed | No |

`Available` comes from media thumbnail metadata; it does not mean the displayed
image has finished downloading or decoding. For an already generated thumbnail,
`Thumbnail.load()` does not enqueue a request and never sets `loading = true`, even
when the browser cache is cold. This state limitation predates the flicker fix:
the old template used the same animation binding and omitted the loading component
altogether when `thumbnail.Available` was true. It explains why restoring contrast
alone will not provide feedback throughout every image-loading path.

**Recommended fix:** keep the stable tile dimensions, opaque background and
image decode/reveal protections. Give the indicator a contrasting foreground
(or a separate spinner/pulse layer) and explicitly define which waiting states
should animate. A short display delay can avoid flashing an indicator for fast
cached images. Preserve error feedback and respect reduced-motion preferences.
Do not restore visibility by simply deleting the anti-flicker background.

Verification completed: traced the current template, CSS, generation queue and
thumbnail availability logic, and compared the flicker-fix patch with its parent.
This establishes the code-level cause; no live browser reproduction was performed.
Before implementation is accepted, check missing/generated thumbnails, a cold
browser cache, throttled requests, queue saturation, decoding, errors, both themes
and reduced motion. The placeholder simplification in item 6 must retain visible
loading feedback rather than removing the animation as an optimization.

### 2. High: thumbnail geometry mixes parent-relative and document coordinates

Sources: `src/frontend/app/ui/gallery/grid/photo/photo.grid.gallery.component.ts:221`
and `:302`; `src/frontend/app/ui/gallery/lightbox/lightbox.gallery.component.ts:275`.

`isInView()` compares document scroll position with `.photo-container.offsetTop`.
The container lives inside a positioned photo component host, so that offset is
relative to the host, rather than its position down the page. Similarly,
`getDimension()` reads the image's offset parent's offsets: this is the container's
position relative to the host. Lightbox code then subtracts document scroll from
the result. This can misclassify visible thumbnails and supply incorrect opening
and closing animation coordinates.

Use a bounding rectangle for viewport visibility. For the existing lightbox
contract, convert its rectangle to document coordinates by adding scroll offsets.
Define whether animation dimensions include the current hover scale and use a
consistent coordinate system throughout. A shared IntersectionObserver is also a
candidate for thumbnail prioritization after correcting the geometry.

Validation: later rows, nonzero scroll, grouped headers, timeline rail, hovered
tiles, and opening/closing the lightbox. [MDN offsetTop reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/offsetTop).

### 3. High: resize explicitly destroys all rendered photo components

Sources: `src/frontend/app/ui/gallery/grid/grid.gallery.component.ts:196`, `:455`,
`:507`; `src/frontend/app/ui/gallery/grid/grid.gallery.component.html:4` and `:37`.

Container dimension changes call `clearRenderedPhotos()`, which assigns an empty
array and immediately calls `detectChanges()`. Replacement rows contain new group
and GridMedia objects, and both loops track object identity. Consequently resize
destroys and rebuilds tiles, thumbnail handles and loading state. This is a concrete
source of DOM churn and a plausible contributor to flicker; the current min-height
protection addresses height stability, not component preservation.

Reconcile new layout data with existing tiles and use stable group/media identity.
Changing the `track` expression alone will not help while an empty intermediate
render is forced. Also, photo initialization currently happens in `ngOnInit()`:
reusing components requires handling changed inputs and thumbnail size selection.
Keep height protection until equivalent behavior is demonstrated.

Validation: node identity survives resize, cached tiles do not restart loading,
sort/filter results stay correct, grid-size changes pick appropriate thumbnails,
and Back restores nonzero scroll. [Angular tracking guidance](https://angular.dev/guide/templates/control-flow).

### 4. Medium: a template creates a fresh observable on every check

Sources: `src/frontend/app/ui/gallery/grid/grid.gallery.component.html:30`;
`src/frontend/app/ui/gallery/blog/blog.service.ts:42`.

`blogService.getMarkDowns(group.date) | async` creates a new piped observable each
time the expression runs. AsyncPipe therefore unsubscribes and subscribes again.
This adds allocations, subscription work and repeated filtering for each dated
group. The shared source uses `shareReplay(1)`, so this finding does not imply a
fresh HTTP request on every check.

Keep a stable observable per group/date or prepare grouped blog data once when
inputs change. The blog component already stores its observable in `ngOnChanges()`.
Validate subscription counts and rendering when content/group dates change.
[Angular AsyncPipe reference](https://angular.dev/api/common/AsyncPipe).

### 5. Medium: hover handling does unnecessary work inside each tile

Sources: `src/frontend/app/ui/gallery/grid/photo/photo.grid.gallery.component.html:1`;
`photo.grid.gallery.component.ts:269`; `photo.grid.gallery.component.css:24`.

`mouseover`/`mouseout` bubble from descendants. Moving between the image, caption,
icons and links repeatedly invokes handlers that schedule/cancel hide timers.
Use tile-boundary enter/leave events and retain delayed removal if needed for the
exit animation. Add focus handling alongside hover.

The info panel also defines both keyframe animations and transitions for the same
properties. Consolidate into one mechanism, anchored explicitly at the bottom,
and check rapid re-entry so an interrupted animation does not jump. Its
`display: table-caption` is unnecessary for an absolutely positioned overlay.
[MDN mouseenter reference](https://developer.mozilla.org/en-US/docs/Web/API/Element/mouseenter_event).

### 6. Medium: avoidable DOM and animation cost in loading placeholders

Source: `src/frontend/app/ui/gallery/grid/photo/loading/loading.photo.grid.gallery.component.html:6`.

Each non-error loading component contains a wrapper plus nine cube divs, in
addition to its component host: 11 elements per pending tile. The cubes exist even
when their animation is disabled. A single placeholder element/pseudo-element
would substantially reduce temporary DOM for a large batch of pending thumbnails.
If the nine-cube visual must remain, instantiate its structure only when needed.

Retain reserved tile dimensions and the decoded-image reveal behavior. Measure
cold-cache loading with many small tiles; compare element count, animation work
and frame timing. Loaded tiles already remove this subtree, which is good.

### 7. Medium: incremental loading does not bound the rendered DOM

Sources: `src/frontend/app/ui/gallery/grid/grid.gallery.component.ts:370`, `:476`.

Scrolling appends rows without evicting earlier rows. Long browsing sessions can
retain many photo components, images and event bindings. Eager change detection
makes repeated template evaluation another cost as that collection grows.

Profile long gallery/timeline sessions before investing in row virtualization.
Virtualization must preserve row heights, grouped headers/blogs, Back restoration,
keyboard focus and lightbox navigation/animation targets. This is a separate
feature-sized change. CSS `content-visibility` alone would not remove Angular
components or their change-detection work.

### 8. Medium: some loop keys are not unique for valid data

Source: `src/frontend/app/ui/gallery/grid/photo/photo.grid.gallery.component.html:33` and `:70`.

Keywords are tracked by `value`, but the list combines person names and keywords.
A person named "Paris" and a keyword "Paris" collide. Use type plus value, and
deduplicate repeated values within a type. Extension buttons are tracked by name,
although buttons from multiple extensions are combined. Use extension identity
plus a genuinely unique per-extension key, or stable button object identity when
the prepared list remains unchanged.

Validate these collisions explicitly rather than globally changing loops to
`track $index`, which is inappropriate for reorderable media collections.

### 9. Medium: interactive markup and focus behavior need attention

Sources: `src/frontend/app/ui/gallery/grid/grid.gallery.component.html:38`;
`src/frontend/app/ui/gallery/grid/photo/photo.grid.gallery.component.css:187`;
`src/frontend/app/ui/albums/album/album.component.html`;
`src/frontend/app/ui/faces/face/face.component.html`.

Photo opening is attached to a non-focusable component host. Extension buttons
can receive keyboard focus while remaining at opacity zero because visibility
depends on hover. Album delete and face favorite actions are click handlers on
icons inside navigation links.

Provide an explicit keyboard-accessible photo-open action, visible focus states,
and `:focus-within`/`:focus-visible` behavior for controls. Use semantic buttons
for delete/favorite actions as siblings of navigation links, avoiding nested
interactive controls. Preserve the ability to search from caption links without
also opening the photo through the parent click handler.

### 10. Medium: layout reads occur inside a template binding

Source: `src/frontend/app/ui/gallery/navigator/navigator.gallery.component.html:212`.

The filter max-height expression calls `getBoundingClientRect()` twice and creates
a SafeStyle wrapper on every check while filters are shown. These reads can force
layout when preceding changes have invalidated it. Prefer CSS positioning where
possible, or cache one measurement and update it when relevant layout/scroll
conditions change. A resize observer alone will not detect every position change.

### 11. Low: legacy compatibility code and CSS leftovers remain

- `photo.grid.gallery.component.css:65`: prefixed transition duplicates, including
  `-ms-` and `-o-`. Similar blocks occur in lightbox/map styles.
- `gallery/lightbox/controls/inputrange.css:39` and
  `gallery/filter/filter.gallery.component.css:167`: old `::-ms-*` slider rules.
- `gallery/fullscreen.service.ts:37`: `msRequestFullscreen` fallback.
- `app/model/page.helper.ts:3`: old page-offset/compatibility-mode scroll fallbacks.
- `src/frontend/styles.css:24`: `element.style { width: 100px; }` appears to be a
  DevTools copy/paste artifact; it selects an `element` tag with class `style`,
  rather than representing inline styles.
- `photo.grid.gallery.component.css:162` and `:191`: the second `.media-button`
  transition overwrites the first. Combine opacity and background-color explicitly.
- Broad `transition: all` remains on lightbox/map/card elements. Name only the
  properties that actually need animation.
- No `prefers-reduced-motion` handling was found in frontend source. Cover custom
  loading/hover CSS and JavaScript lightbox animations; dependency styles may
  independently support the preference.

Remove obsolete rules selectively against the project's browser support policy.
Do not mechanically remove every WebKit/Mozilla declaration: browser-specific
range-control selectors and some platform fallbacks require separate assessment.
[MDN reduced-motion reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion).

## Deprecated API usages in frontend codebase

Static AST analysis of the frontend TypeScript programs (`src/frontend/tsconfig.app.json` and `src/frontend/tsconfig.spec.json`) identified 12 deprecated function and method calls across 6 files:

### 1. Angular Router: `Router.isActive`
* **Locations:**
  * `src/frontend/app/model/navigation.service.ts:22`: `this.router.isActive(...)`
  * `src/frontend/app/model/navigation.service.ts:24`: `this.router.isActive(...)`
  * `src/frontend/app/model/navigation.service.ts:32`: `this.router.isActive(...)`
* **Deprecation status:** Deprecated since Angular 21.1 (`@deprecated 21.1 - Use the isActive function instead`).
* **Recommended replacement:** Import and use the standalone `isActive` function from `@angular/router`:
  ```typescript
  import { isActive } from '@angular/router';
  // isActive(urlTree, matchOptions, currentUrlTree)
  ```

### 2. RxJS: `throwError` and `toPromise`
* **Locations:**
  * `src/frontend/app/model/network/helper/error.interceptor.ts:38`: `throwError(err)`
  * `src/frontend/app/ui/gallery/gallery.component.ts:257`: `this.shareService.currentSharing.pipe(take(1)).toPromise()`
* **Deprecation status:**
  * `throwError(err)`: Passing an error instance directly is deprecated in RxJS 7 and removed in RxJS 8 (`@deprecated Support for passing an error value will be removed in v8. Instead, pass a factory function to throwError(() => new Error('test'))`).
  * `toPromise()`: Deprecated in RxJS 7 and removed in RxJS 8 (`@deprecated Replaced with firstValueFrom and lastValueFrom`).
* **Recommended replacement:**
  * Replace `throwError(err)` with factory syntax: `throwError(() => err)`.
  * Replace `.pipe(take(1)).toPromise()` with `firstValueFrom(this.shareService.currentSharing)`.

### 3. JavaScript Standard Library: `String.prototype.substr`
* **Locations:**
  * `src/frontend/app/ui/gallery/MediaIcon.ts:19`: `this.media.name.substr(...)`
  * `src/frontend/app/ui/gallery/search/search-field-base/search-field-base.gallery.component.ts:101`: `this.autoCompleteItems.value[itemIndex].queryHint.substr(...)`
  * `src/frontend/app/ui/gallery/search/search-field-base/search-field-base.gallery.component.ts:173`: `this.rawSearchText.substr(...)`
* **Deprecation status:** Legacy ECMAScript Annex B feature (`@deprecated A legacy feature for browser compatibility`).
* **Recommended replacement:** Replace with `substring(start, end)` or `slice(start, end)`.

### 4. Angular HTTP Testing: `TestRequest.prototype.error` with `ErrorEvent`
* **Locations:**
  * `src/frontend/app/model/network/network.service.spec.ts:165`: `mockReq.error(new ErrorEvent(...))`
  * `src/frontend/app/model/network/network.service.spec.ts:187`: `mockReq.error(new ErrorEvent(...))`
  * `src/frontend/app/model/network/network.service.spec.ts:209`: `mockReq.error(new ErrorEvent(...))`
  * `src/frontend/app/model/network/network.service.spec.ts:230`: `mockReq.error(new ErrorEvent(...))`
* **Deprecation status:** `@deprecated Http requests never emit an ErrorEvent. Please specify a ProgressEvent.`
* **Recommended replacement:** Pass a `ProgressEvent('error')` to `mockReq.error(...)`.


## Preserve during cleanup

- Explicit tile dimensions and loading background prevent geometry shifts.
- Conditional info panels keep metadata DOM out of every idle tile.
- Existing decoded-image reveal, cached-image checks and height stabilization
  deserve browser regression coverage before alteration.
- The justified layout uses aspect ratios and explicit pixel dimensions. A generic
  CSS Grid substitution would change its behavior; inline-block is not itself a bug.
- Angular control-flow blocks and ng-container do not add wrapper elements, so
  removing them is not a DOM-size optimization.
- Preserve current Zone.js/Eager behavior as required by AGENTS.md. Any later
  change-detection migration must account for thumbnail callbacks and shared state.

## Suggested implementation sequence

1. Restore visible thumbnail loading feedback while preserving anti-flicker protections.
2. Correct geometry and duplicate keys; add focused regression coverage.
3. Stabilize blog observables; simplify hover events and repair focus behavior.
4. Remove dead compatibility styles and reduce placeholder structure, with visual
   checks for cold/cached image loading and reduced-motion preferences.
5. Preserve tile identity across relayout, measuring node churn and flicker.
6. Profile large galleries and decide whether row virtualization is justified.

For visual changes, build English and use a visible browser tab to test resize,
grouping, repeated hover, lightbox transitions, keyboard/touch input and in-app
Back restoration at nonzero scroll. JSDOM tests alone cannot validate layout or
prove that flicker has been eliminated.
