# Agent Notes

## Main Goal

- Keep this fork as the integration base when bringing in useful upstream changes.
- Fetch the original repository as an `upstream` remote and fetch only the upstream branches or pull-request refs needed for review.
- Create local working branches from this fork for candidate changes. Port compatible commits with cherry-picks; when histories or fork-specific changes differ, adapt the patch locally instead of merging the whole upstream branch.
- Preserve existing fork commits and uncommitted user changes. Validate each port with focused tests before considering it complete.

## Upgrade Status

- Upgrade history and completed step validation are tracked in [UPGRADE_PLAN.md](docs/fork-features/UPGRADE_PLAN.md).
- Security audit fixes and hardening are tracked in [Security-Updates.md](docs/fork-features/Security-Updates.md).
- Known debt and post-upgrade modernization items are tracked in [Techdebt.md](docs/fork-features/Techdebt.md).

## Project Setup

- Use Node.js 24 (`nvm use`, using `.nvmrc` at 24.21.0). The project supports Node `>=24.15.0 <25` and npm `>=11.19.0 <12`; install the pinned npm with `npm install --global npm@11.19.0`, then run `npm ci`. Native modules such as `better-sqlite3` must match the active Node ABI (137 on Node 24).
- To run the local app, build the English frontend with `npm run build-en`, then start the backend with `npm start -- --Server-port=8081`; open `http://localhost:8081/`. The backend serves the built frontend. Do not change Angular's serve configuration for this workflow.
- `npm run build-en` builds only English; `npm run build` builds all 16 locales. Native Node scripts in `scripts/` replace Gulp. Locale arrays are passed through the CLI-owned Angular Architect API.
- Frontend targets use `@angular/build` 22.2.1 (application/esbuild, Vite dev server, extract-i18n, and esbuild Karma). Keep `outputPath.browser: ''` and `outputPath.media: 'assets'` in both Angular configuration and script overrides: the backend and release package expect `dist/<locale>/` and serve CSS resources through `/assets/`.
- Browser build/test targets replace `src/common/config/private/Config.ts` with `src/common/config/public/Config.ts`. Preserve this replacement when overriding `fileReplacements`, including production builds; the shared `SupportedFormats` runtime selector must never bundle backend configuration loading.
- `npm run build-stats` builds English and writes `dist/browser-stats.json`; `npm run analyze` prints an esbuild module-size report. Pass another metafile path with `npm run analyze -- <path>`.
- TypeScript under `src/` is authoritative. `npm run build-backend` compiles it; avoid hand-editing generated JavaScript.
- Backend tests run with `npm run test-backend`. To narrow Mocha tests, append a grep, for example `npm run test-backend -- --grep UploadRouter`.

## Running Tests (for AI agents)

- New terminals do not inherit Node 24. Prefix commands with `source ~/.nvm/nvm.sh && nvm use >/dev/null &&`; otherwise `better-sqlite3` fails with a `NODE_MODULE_VERSION` mismatch.
- Backend (Mocha): DB tests run on SQLite always and on MySQL only when one is reachable. Without MySQL, `mysql` "before all" hooks fail with `ECONNREFUSED`; that is environmental, not a regression.
- MySQL/MariaDB for tests: a local container `pigallery-db` (MariaDB 11.4, `127.0.0.1:3306`, user `pigallery`, password `password`) may exist; check with `podman exec pigallery-db healthcheck.sh --connect --innodb_initialized`. Run with `MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USERNAME=pigallery MYSQL_PASSWORD=password TEST_MYSQL=true npm run test-backend`. Tests drop and recreate `pigallery2_test`; never point them at a database with real data.
- `.mocharc.js` loads `test/setup-local.js`. Inspect it before choosing test connection settings: local assignments can override command-line `MYSQL_*` environment variables. Preserve the user's local setup. When using a temporary setup with `--no-config`, retain `--require ./test/root-hooks.cjs --recursive --timeout=20000` and explicitly exclude `test/folder-reset.js`; the script's basename-only exclusion does not match that path.
- Tests persist config to the ignored `test/tmp/config.json`. A run that ends on the MySQL engine leaves `Database.type: mysql` there, so the next run's SQLite hooks fail with `no such collation sequence: utf8mb4_bin`. Delete that file before a run. MySQL tests also need loopback networking, which the standard sandbox blocks (`ECONNREFUSED` even with the container up).
- The full backend suite on both engines takes several minutes; redirect to a log (`> /tmp/pg-tests.log 2>&1`) and grep `passing|failing` plus `^\s+[0-9]+\) ` for failures instead of piping live output.
- `.mocharc.js` loads `test/root-hooks.cjs` to reset shared managers and close the remaining database pool. The cleanup batch passed 740 tests on SQLite/MariaDB and exited naturally. Keep the root hook when bypassing Mocha config. `npm run test-backend-coverage` collects V8 coverage with c8; `npm run coverage` regenerates LCOV.
- Frontend (Karma): no Chrome is installed; use Brave via `CHROME_BIN=/opt/brave.com/brave/brave npx ng test --watch=false`. Narrow with `--include='src/frontend/app/ui/timeline/**/*.spec.ts'` (repeatable).
- Further Karma work is deferred to its replacement (Techdebt M2). The local Brave wrapper shutdown workaround is recorded in [Techdebt.md](docs/fork-features/Techdebt.md#tooling-build--test-modernization).
- `@angular/build:karma` initializes TestBed and discovers specs. `karma.conf.js` uses only Jasmine and browser/reporting plugins. Keep `zone.js` explicitly listed in the test target's polyfills: this builder detects that literal entry to provide zone-based change detection; hiding it inside `polyfills.ts` selects zoneless tests instead.
- Without a browser, type-check frontend specs with `npx tsc -p src/frontend/tsconfig.spec.json --noEmit` (templates are not checked; `npm run build-en` covers them).
- End-to-End (Cypress):
  - `start-e2e-server` runs on port 8080 (`node ./test/folder-reset test/e2e && node ./src/backend/index --config-path=test/e2e/config.json --Database-dbFolder=test/e2e --Server-port=8080 --Users.suppressDefUserWarn=true`).
  - **`ELECTRON_RUN_AS_NODE=1` gotcha**: The assistant environment sets `ELECTRON_RUN_AS_NODE=1`. When Cypress runs Electron, it treats Electron as raw Node.js and crashes on flags like `--no-sandbox`. **Always prefix Cypress commands with `unset ELECTRON_RUN_AS_NODE &&`**.
  - **Sandbox / Xvfb gotcha**: Cypress headless requires X11/Xvfb display support (`spawn Xvfb ENOENT` occurs inside sandboxes). Use the tool's sandbox escalation option (`sandbox_permissions: "require_escalated"` with `exec_command`).
  - **Port 8080 conflict**: Podman container `src_searxng_1` might bind host port 8080. Prefer a separate backend on an available port and override `CYPRESS_baseUrl`. If temporarily stopping the container is necessary, restore it after testing.
  - Run specific spec: `source ~/.nvm/nvm.sh && nvm use >/dev/null && unset ELECTRON_RUN_AS_NODE && npx cypress run --spec test/cypress/e2e/share.cy.ts`.
  - Full suite: `source ~/.nvm/nvm.sh && nvm use >/dev/null && unset ELECTRON_RUN_AS_NODE && npm run cypress:run`.
  - Overriding target server: Pass `CYPRESS_baseUrl=http://localhost:8081` to run Cypress specs against another running instance (such as the smoke test server on port 8081).
  - Cypress 15.19.0 is required for TypeScript 6; Cypress 14 hardcodes deprecated `downlevelIteration`. A temporary `setupNodeEvents` browser definition works for Brave with `family: 'chromium'`, `name: 'chromium'`, `channel: 'stable'`, the installed browser version, and `/usr/bin/brave-browser-stable`; run with `--browser chromium`. Configs outside the repo need explicit project/support paths. Resolve all of these paths consistently: mixing `/home/...` symlinks and `/mnt/...` real paths can trigger TS 6 `rootDir` errors.
- Browser checks: build with `npm run build-en`, start the backend on 8081, and drive it with the integrated browser tools. Timeline/Folders client state is in memory, so test Back restore with in-app navigation, not full reloads.
- If the integrated browser is unavailable, use automated browser smoke checks and record that distinction. For upload checks, copy demo media into an isolated fixture with separate config/database/cache paths and enable uploads there. Timeline Back checks must restore a nonzero scroll position in the same document; lazily rendered gallery items may require repeated scrolling before assertions.
- If another server already holds 8081, start a second one on 8082 instead of killing it. When the integrated browser tab is not visible (`document.visibilityState === 'hidden'`), `requestAnimationFrame` and animations pause and Playwright clicks/keys never complete; use `page.evaluate(() => el.click())` and verify viewer animations in a visible tab.
- **OpenID Connect (OIDC) Tests & Local Dev Provider**:
  - Automated tests: `source ~/.nvm/nvm.sh && nvm use >/dev/null && npm run test-backend -- --grep OIDC` runs both unit tests (`test/backend/unit/middlewares/OIDCAuthService.spec.ts`) and router tests (`test/backend/integration/routers/OIDCRouter.spec.ts`) against the native in-process `MockOIDCServer` (Node RS256 / JWKS) and SQLite.
  - Interactive local dev testing with Dex container:
    - Config: `test/dex.yaml` (git-ignored to avoid secret scanning; template in `test/dex.sample.yaml`). Port 5556, static users `admin@example.com` / `guest@example.com`, password `password`.
    - Run container: `podman run --name pigallery-dex -d --rm -p 5556:5556 -v ./test/dex.yaml:/etc/dex/config.docker.yaml:ro ghcr.io/dexidp/dex:latest`.
    - Run server: `npm start -- --Server-port=8081 --Users-oidc-enabled=true --Users-oidc-displayName="Dex Dev" --Users-oidc-issuerUrl="http://localhost:5556/dex" --Users-oidc-clientId="pigallery-dev" --Users-oidc-clientSecret="dev-secret-123" --Users-oidc-redirectUri="http://localhost:8081/pgapi/auth/oidc/callback" --Users-oidc-autoCreateUser=true`.
    - Test login at `http://localhost:8081/` -> "Login with Dex Dev". Stop container with `podman stop pigallery-dex`.

## Agent Learnings & Gotchas (Framework Upgrades & Core Architecture)

- **Express 5 & `path-to-regexp` v8**:
  - In Express 5 / `path-to-regexp` v8, inline regexes in path strings (such as `:mediaPath(*\\.(jpg|png))`) and bare wildcard suffixes (`'/gallery*'`, `apiPath + '/*'`) are syntax errors or behave differently. Use native `RegExp` routes (e.g. `new RegExp('^' + apiPath + '/gallery/thumbnail/(?<mediaPath>.+?\\.(?:...))/(?<size>[^/]+)$', 'i')`) with named capture groups.
  - `@types/express` 5 defines `ParamsDictionary` as `[key: string]: string | string[]`. When routing through wildcards or RegExps, route params are typed as `string | string[]`. Middlewares accepting path params (such as `directory` or `mediaPath`) must normalize via `normalizePathParam` (joining array elements with `/`) and cast `as string` where needed for string APIs (`path.normalize`, `parseInt`, or TypeORM queries).
- **`openid-client` v6 ESM in CommonJS Backend**:
  - `openid-client` 6.x is pure ESM, loaded synchronously into our CommonJS backend via Node 24's native `require(esm)` (`import * as client from 'openid-client'`).
  - Use `client.allowInsecureRequests(config)` or `options.execute: [client.allowInsecureRequests]` during discovery when testing against HTTP endpoints (e.g. `http://localhost:5556/dex` or test mock servers).
  - Test suites accessing `/user/me` must explicitly restore `Config.Users.authenticationRequired = true` and `Config.Users.unAuthenticatedUserRole = UserRoles.Guest` in `setUp()` if previous tests modified global unauthenticated user settings.
- **Root `tsconfig.json` vs CommonJS Backend**:
  - `ng update` attempts to set `"moduleResolution": "bundler"` in root `tsconfig.json`.
  - The backend remains CommonJS, so bundler resolution must not be applied to the root config. Since Step 3 it uses `"module": "NodeNext"` / `"moduleResolution": "NodeNext"`; absence of a package ESM `type` preserves CommonJS output. Do not restore deprecated `node` resolution or `downlevelIteration` under TS 6.
  - Shared options are in `tsconfig.base.json`. Frontend app/spec configs inherit that base independently of backend settings and use `bundler`/`ES2022`. Keep strict Angular template checking in the frontend config and frontend sources excluded from the backend compile.
  - TS 6 defaults differ: retain explicit `rootDir`, `types`, and `strict: false` alongside the existing `noImplicitAny: true`. Callable CommonJS modules need default imports; mocks must mutate the module itself, rather than the read-only namespace wrapper. `tslib` is a direct runtime dependency for emitted helpers.
- **Angular 22 & zone.js / ngx-bootstrap**:
  - Keep `provideZoneChangeDetection()` and explicit `ChangeDetectionStrategy.Eager` to preserve the app's current rendering behavior. Keep `withXhr()` for upload progress; Angular 22 otherwise defaults to fetch.
  - ngx-bootstrap **22.0.0** uses signal inputs and direct module imports (no `forRoot()`). The published 21.2 guide prescribes zoneless, but the inspected v22 implementation has no bootstrap assertion and uses explicit render notifications. Retaining zone.js is a local compatibility choice; exercise all Bootstrap controls when updating this combination.
  - Do not revert to ngx-bootstrap 21.0.1 on Angular 22: its `ComponentFactoryResolver` dependency was removed. ngx-toastr **20.0.5** still needs a scoped Angular common/core peer override; verify a visible toast and remove the override when a compatible release exists.
- **Angular Tooling Dependency Pins**:
  - Keep `@angular-devkit/schematics` and `@schematics/angular` aligned with the CLI (currently `22.2.1`). ng-icons has unbounded peer ranges; inspect `npm ls` after updates.
  - `typescript-eslint` **8.71.1** supports TypeScript 6. Check compiler support when updating lint tooling.
  - Keep the obsolete `marked/marked.min.js` entry out of Angular's global scripts. ngx-markdown imports its supported Marked peer directly.
  - Keep ngx-markdown 22's optional `marked-katex-extension` peer installed for its dynamic import, even when math rendering is unused.
  - The cleanup batch replaced `gulpfile.ts` with native Node scripts and removed `ts-node`. The release backend still uses plain `tsc` with `tsconfig.release.json` to preserve CommonJS emission under NodeNext; migrating the frontend builder does not require SSR or an ESM backend.
- **Angular 22 Type Checking and Gestures**:
  - A resize handler with no parameters must use `@HostListener('window:resize')`, without an event argument.
  - Interfaces in decorated frontend classes need explicit type-only imports under TS 6 to avoid nonexistent runtime exports. Do not change runtime class imports used as injection tokens to type-only imports.
  - Angular removed its Hammer APIs in v22. `LightboxGesturesDirective` now handles pointer capture, swipe/pan/pinch/tap and cancellation only on the lightbox gesture surface. Preserve its interactive-child exclusions and regression tests.
- **Backend Tests Need a Built Frontend**:
  - Build the frontend before running the full backend suite. `PublicRouter` sharing tests read `dist/en/index.html` and fail with `ENOENT` if it is absent.
- **SQLite Search LIKE Escaping**:
  - SQLite LIKE queries require an explicit `ESCAPE '\\'` clause, and glob-to-LIKE conversion must escape literal `_` and `%`.
- **MariaDB / MySQL Duplicate Index Definition**:
  - In TypeORM entities, applying both `@Index({unique: true})` and `@Column({unique: true})` to the same column causes TypeORM schema synchronization in MySQL/MariaDB to generate two identical index creation statements (`Duplicate key name 'IDX_...'`), crashing startup or migration. Use `@Column({unique: true})` alone; it safely enforces the unique constraint and index across SQLite, MySQL, and MariaDB.
- **CSRF & Cookie Protection Architecture**:
  - Session cookies use `httpOnly: true`, `sameSite: 'lax'`, and `signed: true`. Double-submit CSRF cookie `pigallery2-csrf-token` is validated via `PI-GALLERY2-CSRF-TOKEN` / `X-CSRF-TOKEN` HTTP header on mutating methods (`POST`, `PUT`, `DELETE`). Safe methods (`GET`, `HEAD`, `OPTIONS`) and public authentication endpoints (`/login`, `/share/:key/login`, `/auth/oidc/callback`) bypass CSRF token checks. `NetworkService` automatically attaches the CSRF token to frontend mutating requests.
- **SafePath Lexical Containment**:
  - `SafePath.resolve(baseDir, untrustedPath)` validates that the resolved path strictly resides within `baseDir` (`target.startsWith(baseDir + path.sep) || target === baseDir`). It strips null bytes and normalizes gallery root representations (treating leading `/` or empty strings as within `baseDir`).
- **Leaflet & MarkerCluster Typing**:
  - `@bluehalo/ngx-leaflet-markercluster` 20+ no longer ambiently exports/imports the `leaflet.markercluster` module.
  - Any file referencing `MarkerClusterGroup` or `L.markerClusterGroup` must explicitly include `import 'leaflet.markercluster';`.
- **Angular Block Control-Flow Schematic (`@if`, `@for`, `@switch`)**:
  - The automated migration (`ng g @angular/core:control-flow`) fails if there is stray whitespace or text nodes between `[ngSwitch]` cases. Strip intermediate text nodes beforehand.
  - Check transformed `track` expressions: schematics may produce `track trackByIndex(i, $item)` when `trackBy` existed; simplify to `track $index` or `track item.id` if compilation flags method signature mismatches.
  - Audit templates for unclosed or malformed HTML tags (like unclosed `<option>` tags), which cause template parse errors when converted to block syntax.
- **`ErrorInterceptor` & 401 Infinite Logout Loop**:
  - An HTTP 401 from endpoints like `/user/me` (session check) or `/login` (bad credentials) must NOT trigger `authService.logout()`. If `logout()` is called, it attempts to fetch the sharing session (`getSessionUser()`), which calls `/user/me`, resulting in 401, infinitely looping.
  - Keep 401 interceptor auto-logout guarded: only trigger logout if `authService.isAuthenticated()` is true and the request URL does not include `/user/me`, `/login`, or `/logout`.
- **Backend CLI Configuration Flags**:
  - Backend configuration uses `typeconfig`. Command-line flags map to nested keys with hyphens, e.g. `--Server-port=8081` and `--Upload-enabled=true`.
  - By default, `Upload.enabled` is `false`. When testing upload workflows against a standalone server instance, start with `--Upload-enabled=true`.
- **Node 24 / npm and Docker native builds**:
  - Keep the Node 24 minimum at 24.15.0 for Angular 22. `.nvmrc` pins the validated patch; CI and Docker use npm 11.19.0. Node 22 is no longer supported by this fork.
  - Angular DevKit 22 has an optional Chokidar 5 peer. Pin `chokidar` 5.0.0 directly: regenerating the lockfile can otherwise drop its nested copies and resolve the peer to Mocha's Chokidar 4, producing an invalid tree. Check `npm ls --all` after lockfile changes. npm 12 is deferred: its new default blocks dependency install scripts; review explicit approvals before removing the npm <12 cap (Techdebt T7).
  - Sharp 0.35.5 no longer builds itself during `npm install` / `npm rebuild`. Docker explicitly runs its `build` script. It needs libvips >=8.18.7; `docker/build-libvips.sh` builds the pinned, checksum-verified version with the distribution codec libraries, HEIC, and LibRaw (`-Draw=enabled`) support. Preserve `/usr/local/lib`, its loader path and the Docker context exception in `.dockerignore`.
  - Official Node 24 images do not support ARMv7. Build amd64 and arm64 images; Raspberry Pi deployments require a 64-bit OS.
- **Camera RAW & Embedded Preview Extraction (`.cr2`, `.arw`)**:
  - Canon CR2 and camera RAW files embed pre-rendered JPEG previews. `PhotoWorker` extracts embedded previews via `exifr` (`ifd0.StripOffsets` / `StripByteCounts` or `ThumbnailOffset`) and feeds the buffer into `sharp`. This avoids generic `libtiff` decoding failures (`Old-style JPEG compression support is not configured`) and avoids expensive sensor demosaicing during thumbnail generation.
  - In Docker builds, `docker/build-libvips.sh` compiles libvips with `-Draw=enabled`, and Debian Dockerfiles include `libraw-dev` / `libraw23t64`.
- **Git Operations in Sandbox**:
  - `.git` is protected/read-only in standard sandbox mode. Git mutations require the tool's sandbox escalation option (`sandbox_permissions: "require_escalated"` with `exec_command`).
- **Frontend Standalone Route Lazy-Loading & CommonJS Whitelisting**:
  - Secondary routes (`admin`, `duplicates`, `albums`, `faces`, `timeline`) and the `gallery` matcher route use Angular standalone `loadComponent: () => import(...)`. Heavy admin/duplicate/face services are scoped to component-level `providers` (such as `SettingsService` and `ScheduledJobsService` on `AdminComponent`), keeping initial bundle size well within the 2.0 MB budget (1.72 MB).
  - CommonJS modules like `typeconfig` and `leaflet` trigger Webpack optimization bailout warnings unless whitelisted in `angular.json` under `architect.build.options.allowedCommonJsDependencies`.
  - Leaflet's default marker icon is initialized in `MarkerFactory.ts`, eliminating the need to import `Marker` or `LeafletModule` in `main.ts`.

## Security Context

- Security remediation status and audit controls (S1–S5, AUD1–AUD14) are detailed in [Security-Updates.md](docs/fork-features/Security-Updates.md).
- Upload limits: 50 MiB/file, 10 file parts/request, bounded by concurrency semaphore (`MAX_CONCURRENT_UPLOADS = 5`) and exclusive write creation (`wx`).
