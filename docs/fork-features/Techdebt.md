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
| F4 | `@angular/animations` (`AnimationBuilder`, `provideAnimations`) | lightbox, `main.ts` | M | Deprecated since 20.2, planned removal in v23. Replace with CSS transitions or Web Animations API |
| F5 / A2 | `@angular-builders/custom-webpack` → `@angular/build:application` | `angular.json`, build scripts | Closed | Implemented on `refactor/application-builder`; output and release layouts preserved. Details and measured timings below |
| F6 | Karma + Jasmine → Vitest | `karma.conf.js`, frontend specs | M | Karma is deprecated upstream by Angular. Local Brave runner workaround (`CHROME_BIN=/opt/brave.com/brave/brave`) is in place until Vitest migration |
| F7 | Full zoneless change detection | `main.ts`, `polyfills.ts` | M | Migrate async state across Gallery, Timeline, and Upload services to Angular Signals; adopt `provideExperimentalZonelessChangeDetection()`; drop `zone.js` |

## Security follow-ups

| # | Item | Priority | Notes |
|---|---|---|---|
| S4 | Tooling / devDependency advisories | M | Last recorded pre-F5 snapshot: 19 advisories; `--omit=dev` was 0. F5 removes webpack packages; no fresh audit count was measured during this migration. Overrode `proxy-addr` to 2.0.8 (Dependabot #5) |

## Tooling / repo hygiene

| # | Item | Priority | Notes |
|---|---|---|---|
| T1 | Generated `.js` / `.js.map` files next to TypeScript sources | L | Git-ignored, not edited by hand, not picked up by tools |
| T6 | Backend test fixtures tie on unrated album covers | L | Extreme-value test assigns distinct ratings; audit other tied-cover fixtures |
| T7 | npm 12 dependency install-script policy | M | Pinned npm 11.19.0. Review script approvals before lifting npm engine cap |

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
| **R4** | `@ngx-loading-bar/core` (7.0.1) | Angular Signals `LoadingBarService` + CSS progress | Created reactive `LoadingBarService` using Angular `signal()` and `computed()`; replaced 3px loading bar in `FrameComponent` with pure CSS indeterminate animation (`.top-loading-bar`); cleaned `NetworkService` to call `start()` / `complete()` directly. |
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
English builds have no warnings. F4 (animations), F6 (Vitest), and F7
(zoneless) remain separate follow-ups.
