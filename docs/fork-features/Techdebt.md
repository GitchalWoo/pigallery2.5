# Tech debt

Known debt in the fork. Items are deliberately outside the
[upgrade plan](UPGRADE_PLAN.md) unless an item says it blocks a step.
Items resolved during the 7-step upgrade (F1–F3, B1–B3, B5–B7, B9, T2) have
been completed and archived in [UPGRADE_PLAN.md](UPGRADE_PLAN.md).

Priority: **H** = security or blocks upgrades, **M** = deprecated / will break
later, **L** = cleanup.

## Frontend

| # | Item | Where | Priority | Notes |
|---|---|---|---|---|
| F4 | `@angular/animations` (`AnimationBuilder`, `provideAnimations`) | lightbox, `main.ts` | M | Deprecated since 20.2, with removal intended in v23; still available and retained in Step 3. Open/close animation passed in a visible document in Brave. Replace with CSS / `animate.enter`/`leave`; [API status](https://angular.dev/api/animations/AnimationBuilder) |
| F5 | Webpack-based builder through `@angular-builders/custom-webpack` | `angular.json`, `angular.webpack.js`, `karma.conf.js` | M | Only customisation is one `IgnorePlugin`; custom-webpack 22.0.1 retains the output layout. Angular 22 now explicitly warns that webpack support is deprecated; moving to `@angular/build:application` changes output layout and backend serving |
| F6 | Karma + Jasmine test runner | `karma.conf.js` | M | Angular is moving to Vitest; Karma is deprecated upstream. The nested plugin resolution workaround is fragile |
| F7 | zone.js change detection and newer ngx-bootstrap releases | `main.ts`, `polyfills.ts`, `package.json` | M | Step 3 retains `provideZoneChangeDetection()` with ngx-bootstrap 22.0.0 signal APIs and direct module imports. Its published guide prescribes zoneless; the inspected implementation uses signals/explicit render notifications without a bootstrap assertion. This is a locally validated compatibility choice; separate zoneless sub-plan in UPGRADE_PLAN.md. ngx-toastr 20.0.5 still has Angular 21 peers, overridden only for common/core |
| F8 | Stagnant Angular libraries: `ngx-clipboard` 16, `@ngx-loading-bar/core` 7 | `package.json` | M | Confirmed in step 0 & 4: `ngx-clipboard` is used in 3 components and can be replaced with 1 line of native `navigator.clipboard.writeText()` or `@angular/cdk/clipboard`; `@ngx-loading-bar/core` is used only for a 3px top bar in `frame.component` and can be replaced with a small Angular signal service + CSS |

## Backend

| # | Item | Where | Priority | Notes |
|---|---|---|---|---|
| B8 | SQLite text searches miss literal `_` / `%` characters | `SearchManager.ts` (`convertGlobToLike`, `getLikeExpr`) | M | Found during Step 2 smoke validation in unchanged backend code: `IMG_5910.jpg` does not match, while `5910` does. Escaped LIKE patterns need an explicit SQLite `ESCAPE` clause. Fix separately with regression coverage for both database engines |

## Security follow-ups

| # | Item | Priority | Notes |
|---|---|---|---|
| S1 | Implicit cookie / CSRF policy | H | Define `SameSite`/`Secure` and CSRF protection; depends on proxy/HTTPS deployment |
| S2 | No visible login throttling | H | Add rate limiting / backoff on login and the OIDC callback |
| S3 | Upload memory use: multer memory storage, 50 MiB × 10 files per request, no concurrency cap | M | Consider disk storage or a global concurrent-upload limit |
| S4 | Full `npm audit`: 30 advisories in devDependencies/tooling | M | Step 4 snapshot, 2026-10-06: 30 advisories (1 low, 7 moderate, 20 high, 2 critical); `--omit=dev` is 0. Removing the obsolete release compiler reduced the Step 3 total from 36. Includes webpack build/serve tooling, Karma and Mocha/Cypress/Gulp/coverage advisories |
| S5 | Path traversal / CodeQL CWE-22 (19 alerts) | H | Pre-existing path expressions in UploadManager, GalleryMWs, GPX/PhotoProcessing exposed by route modernization; full inventory and remediation plan in [Security-Updates.md](Security-Updates.md) |

## Tooling / repo hygiene

| # | Item | Priority | Notes |
|---|---|---|---|
| T1 | Generated `.js` / `.js.map` files next to TypeScript sources (e.g. `src/frontend/main.js`, `gulpfile.js`) | L | Make sure they are git-ignored, not edited by hand, and not picked up by tools |
| T6 | Backend test fixtures can tie when selecting unrated album covers | L | Found in Step 3: the MySQL extreme-value test sometimes expected Photo1 while the DB selected Photo2. That test now assigns distinct ratings; audit other tied-cover fixtures separately |
| T7 | npm 12 dependency install-script policy | M | Step 4 pins the npm 11.19.0 release bundled with Node 24.21.0. npm 12 blocks dependency install scripts by default, including native binaries and Cypress/FFmpeg setup. Review explicit script approvals and incomplete registry metadata in the inherited lockfile before lifting the npm engine cap |

## Post-upgrade modernization & library cleanup

Items to tackle after the 7-step upgrade plan completes, focused on removing dead code, eliminating obsolete packages, and replacing redundant wrappers with native platform APIs.

### Redundant wrappers with native / standard alternatives

| # | Item | Where | Modern Replacement |
|---|---|---|---|
| R1 | `locale` (0.1.0) middleware | `server.ts`, `PublicRouter.ts` | 13-year-old unmaintained package. Replace with Express built-in `req.acceptsLanguages(Config.Server.languages)` |
| R2 | `ngx-clipboard` (16.0.0) | 3 gallery components | Replace with standard browser `navigator.clipboard.writeText()` or `@angular/cdk/clipboard` (Item F8) |
| R3 | `ngx-device-detector` (12.0.0) | `directories`, `frame` components | Used only for `this.deviceService.isDesktop()`. Replace with standard CSS media queries (`window.matchMedia('(pointer: coarse)')`) or `@angular/cdk/layout` |
| R4 | `@ngx-loading-bar/core` (7.0.1) | `frame.component` | Used only for a 3px top progress bar. Replace with an Angular signal service and a CSS progress element (Item F8) |
| R6 | `xml2js` (0.6.2) → `fast-xml-parser` | `GPXProcessing.ts` | Replace legacy callback parser with high-performance, TypeScript-native `fast-xml-parser` |

### Tooling, build & test modernization

| # | Item | Where | Value / Rationale |
|---|---|---|---|
| M2 | Karma + Jasmine → Vitest | `karma.conf.js`, frontend specs | Karma is deprecated upstream by Angular (Item F6). Defer further Karma work to its replacement with Vitest. |

Karma note (2026-10-07): all 152 frontend tests passed. The local
`/usr/bin/brave-browser-stable` wrapper does not forward termination to its browser
child, so the runner can remain alive after successful tests. Using
`CHROME_BIN=/opt/brave.com/brave/brave` allowed natural shutdown. Keep this as a
local workaround until M2; no further Karma remediation is planned in this batch.

### Angular architecture & performance

| # | Item | Where | Next Steps |
|---|---|---|---|
| A1 | Full zoneless change detection | `main.ts`, `polyfills.ts` | Migrate async state across Gallery, Timeline, and Upload services to Angular Signals; adopt `provideExperimentalZonelessChangeDetection()`; drop `zone.js` (Item F7) |
| A2 | `@angular-builders/custom-webpack` → `@angular/build:application` | `angular.json` | Webpack builder is deprecated in Angular 22 (Item F5). Moving to esbuild application builder yields 5x–10x faster builds and drops Webpack dev-server vulnerabilities |
| A3 | Remove `@angular/animations` | `lightbox`, `main.ts` | Deprecated in Angular 20, planned removal in v23 (Item F4). Replace with CSS transitions or Web Animations API |
| A4 | Initial bundle optimization | Frontend lazy routes/chunks | Split heavy dependencies (`leaflet`, `ngx-markdown`, `katex`, icons) into lazy chunks to get the initial bundle comfortably below the 2 MB warning threshold |

## Completed dependency and tooling cleanup (2026-10-07)

Implemented on `cleanup/dependencies-and-tooling`; these IDs are closed locally
and retained here for traceability.

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
189 backend/common TypeScript files. Existing lint, Sonar, and security audit
checks were not rerun; earlier advisory counts above remain historical snapshots.
