# Implement zoneless

Status: **idea / proposed plan**, recorded 2026-10-09. This document does not
authorize implementation or claim that the application is already zoneless.
It is the component-level plan for F7 in [Techdebt.md](Techdebt.md), following
the earlier evaluation recorded there and in [UPGRADE_PLAN.md](UPGRADE_PLAN.md).

## Goal

Make frontend rendering independent of Zone.js without regressing gallery
loading, thumbnail feedback, navigation, scroll restoration, uploads, settings,
or third-party controls. Prepare components incrementally while retaining
Zone.js in production; switch the application only after readiness gates pass.

The inventory covers all 56 components present on 2026-10-09, plus the lightbox
gesture directive and supporting services. Readiness assessments are based on
code inspection, not a completed zoneless runtime validation. Reconcile the
inventory with any components added before implementation.

## Compatibility and implementation rules

- Keep `provideZoneChangeDetection()` in [main.ts](../../src/frontend/main.ts)
  and the `zone.js` build polyfill in [angular.json](../../angular.json) during
  preparation. Zoneless is an application setting, not a per-component mode.
- Keep existing `markForCheck()` calls. They are compatible with Zone.js and
  zoneless Angular: they mark views and notify the scheduler rather than
  synchronously rendering like `detectChanges()`. Notifications are generally
  coalesced; an explicit notification does not inherently cause two immediate
  renders when Zone.js is enabled.
- Prefer the smallest suitable mechanism: signals for owned state, AsyncPipe or
  a lifecycle-owned `toSignal()` adapter for observable state, and
  `markForCheck()` for imperative callbacks. Do not create adapters in getters.
- Plain property mutations in promises, timers, manual RxJS subscriptions, and
  native callbacks do not inherently notify Angular. Neither
  `BehaviorSubject.next()` nor reading `.value` is a render notification by
  itself; every rendered consumer needs reactive consumption or explicit marking.
- Angular-bound template and host listeners already notify Angular. Audit their
  asynchronous continuations rather than adding marking to every handler.
- Neither an application-wide signal rewrite nor an OnPush conversion is
  required. Retain existing Eager strategies initially; changing strategy does
  not fix missing notifications.
- Preserve public service contracts where practical. Add reactive adapters
  instead of unnecessarily replacing RxJS APIs consumed elsewhere.
- Preserve stale-request/decode guards, usable-preview fallback, configuration
  cloning, lazy rendering, route behavior, and cleanup after destruction.
- Retain synchronous `detectChanges()` only where immediate view/layout work
  actually requires it. Do not mechanically replace calls or add polling loops
  that repeatedly force change detection.

## Phased rollout

All phases are proposed and not started. Each phase should be independently
reviewable and validated before expanding scope.

| Phase | Scope | Exit requirement |
| --- | --- | --- |
| 0 | Explicit zoneless component-test harness | Show automatic async DOM updates and a test that fails when its required notification is omitted. |
| 1 | Thumbnail state and its consumers | Generation, decode, failure, replacement previews, and delayed caption updates render correctly. |
| 2 | Shared state, app shell, authentication, collection pages | HTTP/service emissions update views without another click. |
| 3 | Gallery, grid, timeline, lightbox | Lazy rendering, layout, animation, autoplay, and Back restoration pass. |
| 4 | Search, sharing, settings, forms, jobs | Async results, programmatic form changes, polling, and error states render. |
| 5 | Maps and third-party integrations | Leaflet, modals, dropdowns, date/time pickers, and visible toasts pass browser checks. |
| 6 | Application-wide zoneless cutover | Full frontend suite, build, and browser gates pass before removing Zone.js. |

## Component migration matrix

Grouped rows apply to every named component. Verification-only means test
readiness first and change code only if a specific gap is found. Existing
notifications are useful evidence, not proof that all update paths are covered.

| Components | Planned work | Acceptance check |
| --- | --- | --- |
| `GalleryPhotoComponent` | Keep decode notifications and stale guards; notify after caption-hide timer and thumbnail generation failure. | Placeholder, warning, decoded image, and delayed caption update automatically; stale decode cannot win. |
| `GalleryDirectoryComponent`, `AlbumComponent`, `FaceComponent`, `DuplicatesPhotoComponent` | Consume reactive thumbnail/icon/person state or register explicit state-change notifications, including failure transitions. Audit permissions and mutation results where applicable. | Generated covers appear without interaction; failure and preview upgrades render; deletion/favourite changes and cleanup work. |
| `GalleryPhotoLoadingComponent` | Verify input-driven rendering; retain CSS animation. | Loading/error transitions follow parent inputs. |
| `MediaButtonModalComponent` | Adapt the modal-data subscription to reactive consumption or explicit marking. | Service-driven opening, closing, and form initialization render. |
| `AppComponent` | Verify async sharing initialization and authentication-driven routing; no blanket marking needed for its router-only template. | Initial login redirect, logout redirect, sharing session, and error-page behavior remain correct. |
| `FrameComponent` | Make user, permissions, notification counts, and other dynamic service reads reactive; retain loading-bar signal. | User name, navigation permissions, badges, loading bar, and mobile navbar update. |
| `LoginComponent`, `ShareLoginComponent` | Notify for post-await busy/error state changes, including failure/finally paths. | Failed login displays errors and reenables controls without another click. |
| `AlbumsComponent` | Retain existing AsyncPipe list; audit sharing initialization and save-search async state. | Initial list, creation, empty state, and errors render. |
| `FacesComponent`, `FacesNavigatorComponent` | Retain reactive face lists; verify sorting and direct service-state reads. | Favourite moves and sorting update both lists and selected controls. |
| `DuplicateComponent` | Notify after duplicate subscription processing and deferred incremental rendering. | Results and additional batches appear; teardown stops pending work. |
| `GalleryComponent` | Notify after content/route/sharing continuations; retain countdown signal; audit derived plain fields. | Initial content, polling, errors, search results, and sharing permissions update. |
| `GalleryGridComponent` | Audit deferred render/layout writes and query-list callbacks; notify after batches, including min-height reset. Preserve necessary synchronous layout checks. | Resize, sorting, incremental rows, reveal-media, and min-height settling work without stale layout. |
| `TimelineComponent` | Preserve existing notifications; audit store callbacks, scroll frames, restoration retries, and loading state. | Pagination and navigation restore a nonzero scroll position in the same document. |
| `GalleryLightboxComponent` | Audit route/source subscriptions, animation completions, delayed visibility, and load-more promises; retain current marking. | Open/close, next/previous, Back, source growth, and animation completion render reliably. |
| `GalleryLightboxMediaComponent` | Retain decode notification; audit native preload callbacks and state consumed outside this component. | Thumbnail-to-full-image transition, preload-dependent behavior, video, and Live Photo states update. |
| `ControlsLightboxComponent` | Notify after hide-controls timer and autoplay callbacks; distinguish direct canvas drawing from template state. | Controls hide automatically; autoplay advances; playback controls stay current. |
| `InfoPanelLightboxComponent` | Verify input-driven metadata and dynamically consumed service state. | Metadata follows media changes and asynchronous updates. |
| `GalleryNavigatorComponent` | Replace dynamic `.value` reads with reactive consumption for sorting, grouping, filters, grid size, and content. | Programmatic/service-originated changes update selected controls and breadcrumbs. |
| `GalleryFilterComponent` | Notify deferred filter visibility changes; make rendered filter state reactive. | Filter closing, active indicators, and results update. |
| `DirectoriesComponent`, `GalleryBlogComponent` | Verify input-driven updates and third-party markdown completion where applicable. | New directory/blog content renders without incidental events. |
| `UploaderComponent` | Retain computed progress; audit remaining service-derived flags and completion/error transitions. | Progress, speed, queue, failure, and final completion render automatically. |
| `GallerySearchComponent` | Notify route subscription and save-search completion/error state. | Route-driven query changes and save outcomes render. |
| `GallerySearchFieldBaseComponent` | Notify autocomplete subscription results; preserve cancellation and cleanup. | Delayed results, empty results, and replacement queries update without extra typing. |
| `GallerySearchFieldComponent`, `GallerySearchQueryEntryComponent`, `GallerySearchQueryBuilderComponent` | Verify inherited async notifications, parent/child propagation, validation, and external query replacement. | Nested query edits and asynchronously supplied options render correctly. |
| `GalleryShareComponent` | Make content subscription and post-await sharing/list/clipboard state explicit. | Create, update, delete, copy feedback, busy states, and errors render. |
| `PhotoFrameBuilderGalleryComponent`, `RandomQueryBuilderGalleryComponent` | Notify route/content subscriptions and clipboard continuations. | Generated URL, preview, and copy feedback update. |
| `AdminComponent` | Notify deferred settings-component discovery; verify child-derived navigation labels. | Settings navigation populates after view initialization. |
| `TemplateComponent` | Notify settings emissions, deferred dirty calculation, form changes, save/reset, and extension operations. Preserve configuration cloning semantics. | Dirty markers, visibility, validity, busy/error states, save, and reset render. |
| `SettingsEntryComponent` | Notify FileReader completion and programmatic control updates; audit custom form behavior. | Imported values, validation, disabled state, and nested fields update. |
| `WorkflowComponent`, `SortingMethodSettingsEntryComponent` | Audit ControlValueAccessor writes and disabled-state handling; keep model-to-view changes separate from user-change callbacks. | Programmatic writes, reset, validation, disabled controls, and edits work. |
| `GalleryStatisticComponent` | Replace statistics `.value` template reads with reactive consumption. | Initial statistics and refreshes appear without interaction. |
| `UsersComponent`, `SharingsListComponent` | Notify fetched lists and mutation completion/error states. | Create/edit/delete refreshes, busy states, and errors render. |
| `ExtensionInstallerComponent` | Notify discovery promise, operation state, and settings refresh completion. | Available extensions, operation status, and failures update. |
| `JobButtonComponent` | Consume job progress reactively instead of getter-only `.value` access; verify async outputs and confirmation modal. | Start/stop/running controls follow polling results. |
| `JobProgressComponent` | Notify elapsed-time timer; ensure refreshed progress reaches the view. | Elapsed time updates without clicks; completion/failure and log modal render. |
| `GalleryMapComponent`, `GalleryMapLightboxComponent` | Audit theme/route subscriptions, GPX promises, timers, and Leaflet callbacks. Notify Angular-owned state, not every Leaflet DOM operation. | Layers, GPX loading/errors, selected media, map navigation, and dark-mode changes work. |
| `TimeStampDatePickerComponent`, `TimeStampTimePickerComponent` | Verify programmatic input changes and third-party value/disabled propagation. | Picker selection, external timestamp changes, and disabled state stay synchronized. |
| `SavedSearchPopupComponent`, `LanguageComponent`, `ErrorComponent`, `IconComponent`, `GridSizeIconComponent`, `SortingMethodIconComponent` | Verification-only initially; change only if async state or third-party behavior exposes a gap. | Inputs and bound interactions render correctly under zoneless tests. |

## Shared prerequisites and integration boundaries

### Thumbnail state

Define one observable/signal state or a consistent state-change callback
covering success, failure, availability, and source replacement across
`Thumbnail`, `IconThumbnail`, and `PersonThumbnail`. Publish coherent state
before notifying consumers. Keep thumbnail prioritization and task cancellation
semantics, and unregister consumer callbacks/subscriptions on destruction.

Start with the photo tile: its decode path already explicitly notifies Angular,
but the caption-hide timer and thumbnail generation-error path need preparation.
Then cover directory, album, face, and duplicate thumbnail consumers rather than
assuming an unrelated parent render will update their URLs.

### Reactive service consumption

Adapt rendered boundaries for `AuthenticationService`, `NotificationService`,
`ContentLoaderService`, `ContentService`, `GalleryService`, `AlbumsService`,
`FacesService`, `DuplicatesService`, `GallerySortingService`,
`GalleryNavigatorService`, `FilterService`, `SettingsService`,
`ScheduledJobsService`, `AutoCompleteService`, and `ShareService`.

Retain RxJS for streams and orchestration where it fits. A service emission must
reach an AsyncPipe, a signal read by the relevant template, or an explicit
component render notification. Audit both `.value` and `getValue()` reads and
getters that conceal dynamic service state. Do not rely on an unrelated signal
or router event happening to refresh the same view.

Preserve uploader progress, loading-bar, and countdown signals. Ensure changes
publish through the signal or observable rather than mutating nested objects
silently. For synchronous side effects that do not affect Angular-owned views,
do not introduce render notifications just for uniformity.

### Forms and native integrations

- Audit reactive-form emissions, programmatic updates, validation, and custom
  ControlValueAccessor `writeValue()` / disabled-state handling. Forms do not
  make every programmatic model change a render notification automatically.
- Audit theme/fullscreen/wakelock callbacks, timeline state producers, and
  `LightboxGesturesDirective`. Bound directive listeners already notify Angular;
  raw callbacks and asynchronous continuations need separate consideration.
- Verify third-party dynamically created views and callbacks with the installed
  ngx-bootstrap, ngx-toastr, Leaflet, and markdown versions. Do not assume
  compatibility solely from peer ranges or unit tests.
- Direct canvas, Web Animations API, Leaflet, and document-title operations need
  no Angular notification unless Angular-bound state also changes. Preserve
  scheduling and layout timing where those operations depend on rendered DOM.

## Validation strategy

### Per-slice tests

Explicitly configure `provideZonelessChangeDetection()` in relevant TestBeds,
even while production still uses Zone.js. Do not rely on runner defaults or
assume that native async/await tests prove zoneless readiness.

An initial fixture render is allowed. Trigger the real completion mechanism,
await Angular stability or advance fake timers and allow scheduled rendering,
then assert the DOM **without a manual post-completion
`fixture.detectChanges()`**. Field-only assertions remain useful for logic but
do not establish render readiness. Avoid a test helper that forces rendering
after every async operation, since it masks missing notifications.

Cover success, rejection, cancellation, stale completion, replacement sources,
and destruction where relevant. Test external service emissions as well as
click-driven changes so a template event cannot accidentally supply the missing
notification. Reuse nearby specs and helpers rather than creating a parallel
test hierarchy.

Use Node 24 for checks as required by [AGENTS.md](../../AGENTS.md):

```bash
source ~/.nvm/nvm.sh && nvm use >/dev/null
npm run test-frontend -- --include='src/frontend/app/ui/gallery/grid/photo/**/*.spec.ts'
npx tsc -p src/frontend/tsconfig.spec.json --noEmit
npm run build-en
```

Adjust the include pattern to the touched slice. Run focused specs after each
implementation slice, spec type-checking and an English build at phase gates,
and the full frontend suite before cutover. Follow existing repository browser
and Cypress setup instructions for browser gates.

### Browser acceptance gates

- Login, failed login, logout, OIDC/session restoration, password-protected
  sharing, and permission-dependent navigation.
- Initial gallery content, polling, generated thumbnails, failure feedback,
  preview replacement, delayed caption hiding, scrolling, sorting, and resize.
- Lightbox open/close, next/previous, autoplay, preload, image decode, video,
  Live Photos, controls timeout, info panel, and animation completion.
- Timeline pagination and nonzero Back scroll restoration in the same document;
  gallery/lightbox and map route restoration.
- Upload queue/progress/speed, cancellation or failure where supported, final
  completion, loading bar, notification badges, and a visibly rendered toast.
- Search/autocomplete/query builders, sharing CRUD/copy feedback, albums,
  favourites, and incremental duplicate rendering.
- Settings load/edit/import/save/reset, programmatic forms, user management,
  extensions, job start/stop/polling, elapsed time, and progress/log modals.
- Leaflet layers/theme, GPX loading/errors, selected media, mobile layouts,
  dropdowns, popovers, modals, datepicker, and timepicker.

## Cutover and rollback

1. Reconcile all component rows with the current frontend and satisfy their
   acceptance checks; no pending component may depend on incidental Zone ticks.
2. Switch application bootstrap to `provideZonelessChangeDetection()` in an
   isolated implementation change. Keep explicit notifications and align tests
   with the intended production mode.
3. Remove the Zone.js build polyfill and check scripts, tests, and dependency
   usage before removing the dependency itself. Avoid unrelated lockfile churn.
4. Run the full frontend suite, spec type-check, English build, and browser
   gates. Complete repository-required release/localization and integration
   checks where affected by the build/dependency change.
5. Merge only after all gates pass. If integration fails, retain or restore the
   zone-based bootstrap/polyfill while keeping compatible preparation changes;
   repair the identified path before retrying cutover.

Do not mark F7 complete until the application runs without Zone.js and the
required workflows have been verified. This idea has no implementation date or
performance claim; measure any rendering or bundle benefit after correctness.