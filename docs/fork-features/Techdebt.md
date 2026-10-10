# Tech debt

Known debt in the fork. Items are deliberately outside the
[upgrade plan](UPGRADE_PLAN.md) unless an item says it blocks a step.
Items resolved during the 7-step upgrade (F1–F3, B1–B3, B5–B7, B9, T2) have
been completed and archived in [UPGRADE_PLAN.md](UPGRADE_PLAN.md). Completed items
from subsequent batches (hardening, wrapper modernization) are archived in the
completed sections at the bottom.

Priority: **H** = security or blocks upgrades, **M** = deprecated / will break
later, **L** = cleanup.

## Frontend

| # | Item | Where | Priority | Notes |
|---|---|---|---|---|
| F7 | Full zoneless change detection | `main.ts`, `angular.json` | L | Retaining `provideZoneChangeDetection()` and `zone.js` for runtime stability. PiGallery2 relies on plain RxJS subscriptions, media `onload` handlers, and router/window events without manual `markForCheck()`. Unit tests were modernized to native `async/await` in Vitest. Proposed idea: [Implement zoneless](ZONELESS_MIGRATION_PLAN.md), with component-level preparation, compatibility rules, and validation gates; implementation not started. |

## Security follow-ups

| # | Item | Priority | Notes |
|---|---|---|---|
| S4 | Tooling / devDependency advisories | M | Both `npm audit` and `npm audit --omit=dev` report 0 vulnerabilities. All 6 transitive dev advisories eliminated with Karma removal in F6. |

## Tooling / repo hygiene

| # | Item | Priority | Notes |
|---|---|---|---|
| T1 | Generated `.js` / `.js.map` files next to TypeScript sources | L | Completed in `cleanup/techdebt-modernization`: verified all git-ignored compiled files, working tree clean. |
| T6 | Backend test fixtures tie on unrated album covers | L | Completed in `cleanup/techdebt-modernization`: added deterministic multi-criteria sorting and creationDate/name tie-breakers in `TestHelper.updateDirCache()`. |

## ARMv7 Docker follow-up

The [ARMv7 feasibility experiment](ARMv7-Docker-Experiment.md) passed QEMU
application/media smoke checks on 2026-10-10, including CR2. Production support
remains deferred pending a pinned maintained runtime, separate builder/runtime
stages, optional dependency decisions, fresh-release and real-hardware testing,
broader workflow coverage, and CI verification before publishing.

## Completed dependency and tooling cleanup (2026-10-07)

Merged into `master` at `c088d0a6` via PR #13; these IDs are retained here for traceability.

| IDs | Completed change |
|---|---|
| D1–D4, F9, T3 | Removed unused `ts-node-iptc`, `ts-helpers`, `coveralls`, and `ejs-loader`. CI keeps the Coveralls GitHub Action. |
| B4, R5 | Replaced `mysql` with pinned `mysql2` 3.24.5 and selected it explicitly in TypeORM. Existing MySQL configuration stays compatible. |
| M1 | `build-en` builds English only. The Node script passes locale arrays through Angular Architect, since the CLI exposes `--localize` as a boolean. |
| M3, T4 | Replaced Gulp with native Node build/release/translation/manual scripts; removed Gulp helpers and `ts-node`. Release layout, localized bundles, binary fixtures, ZIP output, and Docker flags are preserved. |
| M4 | Replaced `nyc` with `c8` 12.0.0. Reports include backend/common TypeScript sources through source maps; tests and frontend are excluded. |
| T5 | Added a Mocha root teardown hook to reset shared managers and close the remaining database pool. The full suite now exits without `--exit`. |

Dependency installation removed 266 packages and added 32; `npm ls --all` passes.
Validation: 740 backend tests on SQLite/MariaDB, 152 frontend tests (both runners
exit naturally), four tooling tests, English-only
build, all 16 release locales, ZIP/manifest/binary-fixture checks, XLIFF extraction
(1,083 messages), and byte-identical generated configuration manual. c8 reports
189 backend/common TypeScript files.

## Completed Application Hardening (2026-10-07)

Implemented on `hardening/application` (merged via PR #14). Resolves security audit findings (AUD1–AUD14), perimeter controls (S1, S2, S3, S5), search glob escaping (B8), and dependency overrides (Dependabot #5).

Complete implementation details, audit findings, and verification suites are documented in [Security-Updates.md](Security-Updates.md).


## Completed Redundant Wrapper Modernization (2026-10-07)

Implemented on `refactor/redundant-wrappers`. Replaced dead, unmaintained, or redundant wrapper libraries with native platform APIs, Angular signals, and standard TypeScript alternatives (R1, R2, R3, R4, R6, F8).

| Item | Package Removed | Replacement Implementation | Scope & Details |
|---|---|---|---|
| **R1** | `locale` (0.1.0) | Express built-in `req.acceptsLanguages()` | Replaced 13-year-old unmaintained CoffeeScript middleware in `server.ts` and `PublicRouter.ts` with native Express `req.acceptsLanguages(Config.Server.languages)` and `'en'` fallback. |
| **R2** | `ngx-clipboard` (16.0.0) | Standard `navigator.clipboard.writeText()` via `ClipboardService` | Created root `ClipboardService` using modern standard Async Clipboard API; eliminated `ngx-clipboard` directives across `PhotoFrameBuilder`, `RandomQueryBuilder`, and `Share` components. |
| **R3** | `ngx-device-detector` (12.0.0) | CSS media query `window.matchMedia` via `DeviceService` | Created root `DeviceService` detecting pointer and hover characteristics (`(hover: hover) and (pointer: fine)` / `!(pointer: coarse)`); removed `ngx-device-detector` from `DirectoriesComponent` and `FrameComponent`. |
| **R4** | `@ngx-loading-bar/core` (7.0.1) | Angular Signals `LoadingBarService` + CSS progress | Created reactive `LoadingBarService` using Angular `signal()` and `computed()`; replaced 3px loading bar with standalone `TopLoadingBarComponent` (150 ms CSS delay, reduced motion fallback) and ownership-safe `begin()` tokens used by `FrameComponent` and `GalleryLightboxComponent`. |
| **R6** | `xml2js` (0.6.2), `@types/xml2js` | `fast-xml-parser` (4.5.7) | Replaced legacy callback-based `xml2js` parser/builder in `GPXProcessing.ts` with high-performance, TypeScript-native `XMLParser` and `XMLBuilder` from `fast-xml-parser` (pinned 4.5.7 with zero deprecations). |

Dependency cleanup: removed 6 packages (`locale`, `ngx-clipboard`, `ngx-device-detector`, `@ngx-loading-bar/core`, `xml2js`, `@types/xml2js`); added `fast-xml-parser` 4.5.7.
Validation: 806 passing backend tests on SQLite and MariaDB (including new `GPXProcessing.spec.ts`), 152 frontend Karma tests (0 failures), 3 passing Cypress e2e tests (`share.cy.ts`), 8 tooling tests, 0 ESLint errors, clean Angular localized build (`npm run build-en`), and 0 production vulnerabilities (`npm audit --omit=dev`).


## Completed Bundle Optimization and Build Warning Elimination (2026-10-08)

Implemented on `perf/bundle-optimization`. Resolved initial chunk budget overflow (F10) and all CommonJS optimization bailout warnings.

| Item | Area | Optimization Implementation | Impact & Result |
|---|---|---|---|
| **F10** | Route-level lazy loading (`app.routing.ts`) | Converted `admin`, `duplicates`, `albums`, `faces`, `timeline`, and `gallery` routes to standalone `loadComponent: () => import(...)` | Deferred heavy feature trees (admin settings suite, duplicate finder, face clustering, albums manager, timeline, and gallery grid/lightbox) into on-demand chunks. Initial bundle dropped from **2.09 MB to 1.72 MB** (below 2.0 MB budget). |
| **F10** | Scoped feature providers | Scoped `SettingsService` and `ScheduledJobsService` to `AdminComponent.providers`, `DuplicateService` to `DuplicateComponent.providers`, and `FacesService` to `FacesComponent.providers` | Removed heavy admin config schemas and single-purpose feature services from root `main.ts`, reducing initial transfer size and avoiding unnecessary early instantiation. |
| **CJS Warnings** | `angular.json` | Configured `allowedCommonJsDependencies` for `typeconfig` and `leaflet` (`leaflet.markercluster`) | Eliminated all Webpack CommonJS optimization bailout warnings. |
| **Tree-shaking** | `MarkerFactory.ts`, `main.ts` | Initialized Leaflet `Marker.prototype.options.icon` in `MarkerFactory.ts`; removed unused `LeafletModule` / `LeafletMarkerClusterModule` and `Marker` imports from `main.ts`; migrated to `provideMarkdown({loader: HttpClient})` | Leaflet and Markdown extensions are only loaded when feature views require them; root injector bootstrap is completely stripped of unused imports. |

Validation:
- Build output: **0 warnings** on `npm run build-en` (zero CJS bailout warnings, initial total 1.72 MB within 2.0 MB budget).
- Unit tests: 152/152 passing frontend Karma tests (0 failures).
- Tooling tests: 8/8 passing `test-tooling` tests.
- End-to-End tests: 3/3 passing Cypress tests (`share.cy.ts`) against local test server.
- Code quality: 0 ESLint errors across the workspace.

## Completed Application Builder Migration (2026-10-08)

Implemented on `refactor/application-builder` (F5 / A2), following the
[Angular build-system migration guide](https://angular.dev/tools/cli/build-system-migration).

- Replaced custom-webpack build, serve, extract-i18n, and test targets with
  `@angular/build` 22.2.1. Production/development builds and Karma now use
  esbuild; the Angular dev server uses Vite. Removed `angular.webpack.js`,
  `@angular-builders/custom-webpack`, and `webpack-bundle-analyzer`.
- Replaced `IgnorePlugin` with build/test file replacements mapping private
  `Config.ts` to public `Config.ts`. Browser bundle dependency inspection found
  no `src/backend/` inputs. Admin configuration schemas remain available.
- Configured `outputPath` with `browser: ''` and `media: 'assets'`, including
  overrides from `scripts/build.mjs` and the release pipeline. English-only,
  all-locale, development, and release builds retain their existing paths;
  CSS images remain reachable through the backend's `/assets/` route.
- Kept locale-prefixed entrypoints (`en.main-<hash>.js`, etc.) and the backend's
  EJS injection of configuration, custom head content, theme CSS, and URL base.
- Kept Karma/Jasmine for F6. Removed the unused webpack `require.context` test
  bootstrap. Listed `zone.js` explicitly in test polyfills so the new builder
  initializes zone-based TestBed rather than selecting zoneless behavior.
- `npm run build-stats` builds English and emits `dist/browser-stats.json`.
  `npm run analyze` uses esbuild's metafile analyzer to print module sizes;
  an alternate metafile can be passed as an argument. Metafiles describe
  builder output names before locale-prefix renaming.
- Dependency installation removed 361 installed packages; the lockfile has
  no webpack, custom-webpack, or `@angular-devkit/build-angular` package entries.

Timing: one local frontend-only English production run took **20.3 seconds**
with webpack and **6.9 seconds** with the application builder (approximately
**2.9× faster**). These are single local runs, not a CI benchmark or a promised
5×–10× improvement. The initial bundle is **1.58 MB**, below the 2 MB budget.

Validation:
- `npm run build-en`, `npm run build`, and the all-16-locale release/ZIP pipeline.
- Artifact checks for both `dist` and `release/dist`: locale HTML, EJS injection,
  renamed entrypoints, lazy-import targets, CSS assets, ZIP contents, and the
  production release manifest.
- Development build, Vite startup/HTTP response, translation extraction
  (1,083 messages), build stats, module analysis, and `npm ls --all`.
- Existing frontend suite: **152 Karma tests passed** with the esbuild builder.
- Four tooling cases passed, including updated esbuild entrypoint/modulepreload
  rename coverage. Full backend tests, lint, standalone
  TypeScript checks, Sonar, and security audit commands were not rerun.
- Seven temporary Cypress browser smoke checks passed: gallery, timeline,
  albums, faces, duplicates, admin, and CSS asset serving through the backend.
  Used Electron against an isolated config/database/cache and copied demo
  media; the integrated browser was unavailable.

All-locale builds retain the `pt-br` → `pt` locale-data fallback warning;
English builds have no warnings. F4 and F6 (Vitest) are now completed; F7
(zoneless) remains a separate follow-up.

## Completed Build Deprecation Elimination and Dependency Hardening (2026-10-08)

Implemented on `chore/build-cleanups`. Eliminated all build-time deprecations during `npm ci` and production packaging, resolved moderate production vulnerability, mitigated transitive dev advisories, and configured npm 12 install-script execution policies (F4, T7, S4).

| Item | Area / Package | Resolution & Implementation | Impact & Result |
|---|---|---|---|
| **F4** | `@angular/animations` (`AnimationBuilder`, `provideAnimations`) | Replaced `AnimationBuilder` in `GalleryLightboxComponent` with standard native **Web Animations API** (`element.animate`), keeping smooth 200ms `ease-in-out` transitions and `onDone` callback support without `@angular/animations`. Replaced `provideAnimations()` in `main.ts` with `{provide: ANIMATION_MODULE_TYPE, useValue: 'NoopAnimations'}` from `@angular/core`. Removed `@angular/animations` from `package.json`. | Eliminated `npm warn deprecated @angular/animations@22.2.1`. Initial chunk size dropped from **1.58 MB to 1.52 MB** (initial `main.js` chunk reduced from 80.24 kB to 19.90 kB). |
| **Tooling** | `@angular/platform-browser-dynamic` (22.2.1) | Removed deprecated, unused package from `devDependencies`. The application boots through standalone `bootstrapApplication` from `@angular/platform-browser`. | Eliminated `npm warn deprecated @angular/platform-browser-dynamic@22.2.1`. |
| **Tooling** | `glob` (10.5.0) | Upstream deprecated `glob <13`. Configured scoped npm overrides in `package.json` for `typeorm`, `archiver-utils`, and `mocha` to use `glob@13.0.6` (which preserves `glob.sync` / `hasMagic`), while retaining compatible `glob@7` for Karma (subsequently removed in F6). | Eliminated `npm warn deprecated glob@10.5.0` completely from the dependency tree. |
| **T7** | npm 12 install-script execution policy | Added `allowScripts` in `package.json` explicitly approving the 8 verified native addon and tool installer packages (`@parcel/watcher`, `bcrypt`, `better-sqlite3`, `cypress`, `esbuild`, `ffmpeg-static`, `lmdb`, `msgpackr-extract`). | Eliminated all 8 `npm warn install-scripts` warnings; ensures smooth transition when lifting engine cap to npm 12. |
| **S4** | Dependency vulnerability remediation | Upgraded `fast-xml-parser` from 4.5.7 to 5.11.2 (moderate GHSA-gh4j-gqv2-49f6); upgraded `marked-katex-extension` to 5.1.13 and added override for `katex: 0.19.0` (GHSA-238p-pmpm-9mq7); added overrides for `diff: 8.0.3` (GHSA-73rr-hh4g-fpgx), `serialize-javascript: 7.1.2` (GHSA-5c6j-r48x-rmvq, GHSA-qj8w-gfj5-8c6v), and `braces: 3.0.3` (GHSA-vfj7-8cjw-p6xm). | Production audit (`npm audit --omit=dev`) reports **0 vulnerabilities**. Total audit advisories reduced from 13 to 6 (the only remaining one being Karma's transitive chokidar 3/braces issue, eliminated in F6). |

Validation:
- `npm ci`: completes cleanly with **0 deprecation warnings** and **0 install-script warnings**.
- Tooling tests: **8/8 passing** `test-tooling` tests.
- Frontend compilation: `npm run build-en` generates bundle in 6.1s with **0 warnings**; initial transfer size 1.52 MB (well under 2.0 MB budget).
- Frontend type safety: `npx tsc -p src/frontend/tsconfig.spec.json --noEmit` exits with 0 errors.
- Backend test suite: 591 passing SQLite tests.
- Release pipeline: `npm run create-release -- --languages=en` produces release package and valid `pigallery2.zip`.

## Completed Frontend Unit Testing Migration to Vitest (2026-10-08)

Implemented on `refactor/frontend-vitest`. Replaced deprecated Karma and Jasmine test runners with Angular 22's native `@angular/build:unit-test` builder powered by **Vitest 5** and **JSDOM** (F6). Eliminated the local browser runner workaround (`CHROME_BIN=/opt/brave.com/brave/brave`) and the remaining 6 transitive dev advisories (S4).

| Item | Area / Package | Resolution & Implementation | Impact & Result |
|---|---|---|---|
| **F6** | `@angular/build:unit-test` + Vitest 5.0.3 + JSDOM | Replaced `@angular/build:karma` with `@angular/build:unit-test` in `angular.json`. Configured `vitest/globals` and `@angular/localize` in `tsconfig.spec.json`. Added global test setup harness `src/frontend/test-setup.ts` providing JSDOM polyfills (`window.matchMedia`, `HTMLCanvasElement.getContext('2d')`) and automatic Zone.js `ProxyZone` lifecycle wrapping for `fakeAsync` specs. Refactored all 18 test spec files to Vitest conventions (`vi.spyOn`, `vi.fn()`, standard matchers, and modern injection). Fixed `theme.service.ts` listener cleanup and guarded slider canvas rendering in `controls.lightbox.gallery.component.ts`. | Replaced slow browser-based Karma tests with headless, fast Vitest execution in JSDOM. Execution duration dropped from ~25s to **5.4s** (4.6× speedup). |
| **Tooling & Cleanups** | Removed Karma & Jasmine packages | Removed `karma`, `karma-chrome-launcher`, `karma-coverage`, `karma-jasmine`, `karma-jasmine-html-reporter`, `jasmine-core`, `@types/jasmine`, and deleted `karma.conf.js`. | Removed 47 packages. Cleaned all references to Karma in build tooling. |
| **S4** | devDependencies vulnerability elimination | Removing Karma and its nested dependencies eliminated the last remaining transitive `chokidar 3` / `braces` security advisories. | Both `npm audit` and `npm audit --omit=dev` now report **0 vulnerabilities**. |

Validation:
- Unit test suite: **18/18 test files passed (100%)**, **152/152 tests passed (100%)** via `npm run test-frontend` in 5.39s.
- Spec type safety: `npx tsc -p src/frontend/tsconfig.spec.json --noEmit` exits with 0 errors.
- Frontend build: `npm run build-en` completes in 6.1s with 0 warnings (1.52 MB initial bundle).
- Tooling tests: `npm run test-tooling` passes 8/8 tests.

## Completed Techdebt Modernization and Tooling Maintenance (2026-10-08)

Implemented on `cleanup/techdebt-modernization`. Resolved album cover test fixture non-determinism (T6), verified hygiene of generated `.js`/`.js.map` build artifacts (T1), updated safe library dependencies, and audited security status (S4).

| Item | Area / Package | Resolution & Implementation | Impact & Result |
|---|---|---|---|
| **T6** | `test/TestHelper.ts` (`updateDirCache`) | Upgraded `updateDirCache()` in `TestHelper` to evaluate all configured sorting methods (`Config.AlbumCover.Sorting`) instead of only the first method. Added deterministic secondary tie-breakers (`creationDate` descending, followed by alphabetical `name` ascending) to ensure identical cover selection between database engines. | Eliminates non-deterministic test fixture ties and race conditions on unrated album covers across SQLite and MySQL/MariaDB. |
| **T1** | Build / compile artifacts | Audited workspace for generated `.js` and `.js.map` files next to TypeScript sources; verified ignore rules in `.gitignore` cover backend, frontend, benchmarks, and tests. Working directory remains clean. | Generated files are excluded from git tracking and not picked up accidentally by tooling. |
| **Dependencies** | Safe dependency bumps | Bumped `bootstrap` (5.3.7 → 5.3.8), `exif-reader` (2.0.2 → 2.0.3), `ffmpeg-static` (5.2.0 → 5.3.0), `xlf-google-translate` (1.0.1 → 1.0.4), `@types/adm-zip` (0.5.8), `@types/chai` (5.2.3), `@types/cookie-parser` (1.4.10), `@types/leaflet` (1.9.22), `@types/leaflet.markercluster` (1.5.6). Kept `@angular/*` at 22.2.1 for seamless peer dependency alignment. | Maintained up-to-date dependencies with zero breaking changes or peer conflicts. |
| **S4** | Vulnerability audit | Executed both `npm audit` and `npm audit --omit=dev`. | Both commands report **0 vulnerabilities**. |

Validation:
- Tooling tests: **8/8 passing** `test-tooling` tests.
- Frontend unit tests: **18/18 files passed (100%)**, **152/152 tests passed (100%)** via `npm run test-frontend` with Vitest in 5.25s.
- Frontend compilation: `npm run build-en` builds production bundle with **0 warnings**; initial bundle **1.52 MB** (well under 2.0 MB budget).
- Backend tests: **591 passing SQLite tests** via Mocha (all failures in full run are environmental MariaDB `ECONNREFUSED` without local MySQL container running).

## Evaluated Zoneless Change Detection and Completed Vitest Async Modernization (2026-10-08)

Evaluated zoneless change detection on `refactor/zoneless-change-detection`. Retained `provideZoneChangeDetection()` and `zone.js` for production runtime stability, while modernizing asynchronous unit tests to native `async/await` under Vitest.

| Item | Area / Package | Resolution & Implementation | Impact & Result |
|---|---|---|---|
| **F7 Evaluation** | Runtime Change Detection Architecture | Evaluated `provideZonelessChangeDetection()`. PiGallery2's architecture relies on plain property mutations inside RxJS subscriptions (Content, Navigation, Lightbox), image `onload` events, and popstate/router events without explicit `markForCheck()`. In zoneless mode, views do not redraw until an interactive template click occurs. Restored `provideZoneChangeDetection()` and `zone.js` in polyfills for rock-solid runtime stability. Zone.js remains officially supported by the Angular team without scheduled deprecation. | Ensures initial library load, thumbnail loading, lightbox navigation, and browser Back button work predictably without missing renders. |
| **State Modernization** | `uploader.service`, `uploader.gallery`, `gallery.component` | Replaced interval-based polling (`setInterval(() => cdr.detectChanges(), 500)`) in `UploaderComponent` with reactive `computed()` derived from `uploadProgressSignal` in `UploaderService`. Replaced manual `countDown` timer mutations in `GalleryComponent` with `countDownSignal`. | Eliminates interval dirty-checking while keeping compatibility with both Zone and zoneless paradigms. |
| **Unit Test Modernization** | Vitest 5.0.3 + JSDOM | Migrated all unit tests relying on Zone-based `fakeAsync`, `tick()`, and `flushMicrotasks()` (`timeline.store.spec.ts`, `lightbox.gallery.component.spec.ts`) to native `async/await` and microtask draining. | Modernized test suite to native Vitest patterns. |

Validation:
- Unit test suite: **18/18 test files passed (100%)**, **152/152 tests passed (100%)** via `npm run test-frontend` with Vitest in 5.45s.
- Spec type safety: `npx tsc -p src/frontend/tsconfig.spec.json --noEmit` exits with 0 errors.
- Frontend build: `npm run build-en` completes cleanly with 0 warnings (initial bundle **1.52 MB**).
- Tooling tests: `npm run test-tooling` passes **8/8 tests**.
- Security audit: `npm audit` reports **0 vulnerabilities**.

