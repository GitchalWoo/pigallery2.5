# Security Updates & Hardening Status

This document tracks security findings, automated scanner alerts (e.g. CodeQL, Dependabot), and hardening implementations in this fork.

---

## 1. Executive Status & Summary

**Application Hardening** is completed on branch `hardening/application` (2026-10-07). All findings from the 2026-10-06 security review (**AUD1–AUD14**), core perimeter controls (**S1, S2, S3, S5**), and SQLite text search escaping (**B8**) have been resolved and validated across 788 passing backend tests (SQLite & MariaDB), 152 frontend Karma tests, and 0 production vulnerabilities.

| Category | Closed | Open / In Progress |
|---|---|---|
| **Perimeter & Resources (S1–S5)** | 5 closed (S1, S2, S3, S4, S5) | 0 open |
| **Audit Findings (AUD1–AUD14)** | 14 closed (AUD1 through AUD14) | 0 open |
| **Search Integrity (B8)** | 1 closed (B8) | 0 open |
| **Dependabot Alerts** | Alert #5 (`proxy-addr`) resolved via override | Alerts #2, #3, #6 eliminated with Karma removal in F6 |

---

## 2. Master Tracking Matrix

| ID | Finding / Vulnerability | Severity | Status | Implementation & Resolution | Verification |
|---|---|---|---|---|---|
| **CodeQL #96** | MD5 permission-projection cache keys | Hardening; practical exploit not established | **Implemented locally; CodeQL recheck pending** | SHA-256 truncated to 32 lowercase hex characters; existing schema and startup cleanup retained. Details in section 3.3. | Backend build; 120 focused SQLite/MariaDB tests; 4 final vector checks |
| **S1** | Implicit cookie policy & missing CSRF protection (CodeQL #112) | High | **Closed** | Enforced `SameSite=lax`, `httpOnly`, `signed` session cookies in `server.ts`. Added double-submit CSRF protection (`CSRFProtection.ts`) issuing `pigallery2-csrf-token` cookie and validating `PI-GALLERY2-CSRF-TOKEN` / `X-CSRF-TOKEN` header on mutating API endpoints (`POST`, `PUT`, `DELETE`). CodeQL #112 is a false positive under OWASP double-submit cookie architecture. | `CSRFProtection.spec.ts` (8 tests) |
| **S2** | Missing rate limiting on authentication endpoints | High | **Closed** | Added sliding-window in-memory IP rate limiter (`RateLimiter.ts`) guarding `/user/login`, `/share/:key/login`, and `/auth/oidc/callback` (10 req/min limit, returning HTTP 429 with `Retry-After`). | `RateLimiter.spec.ts` (2 tests) |
| **S3** | Unbounded upload concurrency in memory | Medium | **Closed** | Added upload concurrency semaphore (`MAX_CONCURRENT_UPLOADS = 5`) returning HTTP 429 when saturated in `UploadMWs.ts`. Preserved 50 MiB/file and 10 parts/request limits. | `UploadMWs.ts`, `UploadRouter.spec.ts` |
| **S4** | Tooling / devDependencies advisories | Medium | **Closed** | Both production audit (`npm audit --omit=dev`) and full audit (`npm audit`) report 0 vulnerabilities. Eliminated remaining 6 transitive dev advisories (Karma's `chokidar 3` / `braces`) by replacing Karma with Vitest (F6). Configured `allowScripts` for npm 12. | Clean `npm ci` (0 warnings), 0 audit vulnerabilities, `Techdebt.md` |
| **S5** | Path traversal and symlink containment (CodeQL CWE-22) | High | **Implemented; CodeQL recheck pending** | Lexical validation plus asynchronous filesystem checks at media, upload, cache and static-asset boundaries. External and unresolved symlinks are rejected. | `PathTraversal.spec.ts`, `FileContainment.spec.ts`, `UploadManager.spec.ts` |
| **AUD1** | Sessions survive user demotion, deletion, or share expiry | High | **Closed** | Implemented `validateExistingSession` in `AuthenticationMWs.ts` rechecking database user existence, role, restrictions, expiry, and sharing record status on every authenticated request. | `AuthenticationMWs.spec.ts` (4 tests) |
| **AUD2** | OIDC account binding by mutable username / missing email verification | High | **Closed** | Bound OIDC identities to `(oidcIssuer, oidcSubject)`, blocked auto-binding to privileged accounts (`Admin`, `Developer`), and enforced `email_verified` when domain allowlist is set. | `OIDCAuthService.spec.ts`, `OIDCRouter.spec.ts` |
| **AUD3** | Share `defaultSearchView` overwrites access boundary `searchQuery` | High | **Closed** | Separated access boundary (`searchQuery`) from initial presentation query (`defaultSearchView`) in `SharingEntity`, `SharingDTO`, `SharingManager`, and `SessionManager`. | `SessionManager.spec.ts` |
| **AUD4** | Schema synchronization drops tables and loses persistent data | High | **Closed** | Replaced destructive database drop with non-destructive schema update in `SQLConnection.ts`; added automatic pre-upgrade SQLite database backups and explicit OIDC schema migration; made `tryConnection()` read-only. | `typeorm.ts`, `OIDCSchemaMigration.spec.ts` |
| **AUD5** | Share-key generation can loop infinitely | High | **Closed** | Fixed key availability detection (`res == null`), bounded collision retry loop (10 attempts max), and enforced unique constraint on `sharingKey` in database (`@Column({unique: true})`). | `SharingMWs.spec.ts` |
| **AUD6** | Password hashes serialized into readable session cookies | Medium | **Closed** | Scrubbed `password` field from user entities before storing in session context across login, OIDC callback, and user settings update. | `SessionManager.spec.ts`, `UserManager.spec.ts` |
| **AUD7** | Protected media served with public caching headers | Medium | **Closed** | Enforced `Cache-Control: private, max-age=31536000, immutable` for media responses; `no-store, no-cache, must-revalidate` for sensitive configuration/user endpoints. | `RenderingMWs.ts` |
| **AUD8** | Predictable administrator credentials created on first boot (`admin/admin`) | High | **Closed** | Replaced default `admin/admin` with cryptographically random 16-character alphanumeric password generated via `crypto.randomBytes` on initial bootstrap. | `SQLConnection.spec.ts` |
| **AUD9** | Secrets in diagnostic logs & URLs | Medium | **Closed** | Redacted sensitive keys (passwords, secrets, tokens) in startup diagnostic logs (`server.ts`); sanitized credential parameters from URLs in `LoggerRouter.ts`. | `server.ts`, `LoggerRouter.ts` |
| **AUD10** | Concurrent upload file overwrite race | Medium | **Closed** | Used atomic exclusive creation flag (`wx`) in `UploadManager.saveFile`; added automatic cleanup unlinking partial files upon write failure. | `UploadManager.spec.ts` |
| **AUD11** | Unhandled ZIP archive stream errors & disconnects | Medium | **Closed** | Added client disconnect listener (`res.on('close')` -> `archive.abort()`), response header error guards, and SafePath containment for all archive entries in `GalleryMWs.zipDirectory`. | `GalleryMWs.ts` |
| **AUD12** | Synchronous password hashing blocks event loop | Medium | **Closed** | Added `cryptPasswordAsync` & `comparePasswordAsync` via bcrypt in `PasswordHelper.ts`; converted authentication and user management to non-blocking async execution. | `PasswordHelper.spec.ts` |
| **AUD13** | Share listing loses search query when filtering by creator | Medium | **Closed** | In `SharingManager.listAllForQuery`, replaced `.where()` with `.andWhere()` to preserve existing search-query filters when applying creator filters. | `SharingManager.spec.ts` |
| **AUD14** | Metafile access directory-level authorization policy | Medium | **Closed** | Verified and documented metafile policy in `GalleryManager.authoriseMetaFile`: requires directory to contain matching media under current projection before granting access. | `GalleryManager.spec.ts` |
| **B8** | SQLite text search misses literal `_` / `%` characters | Medium | **Closed** | Added SQLite `ESCAPE '\\'` clause to LIKE queries and properly escaped literal `_` and `%` in glob pattern conversion in `SearchManager.ts`. | `SearchManager.spec.ts` |

---

## 3. Implementation Details by Domain

### 3.1 Path Traversal & Containment (S5)

- **Context**: Route modernization in Express 5 exposed pre-existing parameter flows to CodeQL's taint tracker (19 alerts for CWE-22 in `GalleryMWs`, `UploadManager`, `GPXProcessing`, `PhotoProcessing`, `GalleryManager`, `PublicRouter`).
- **Remediation**:
  1. `SafePath.resolve` and `isSafe` provide lexical checks only, without filesystem I/O. Generic route normalization does not inspect the gallery filesystem; static assets use their frontend root.
  2. `SafePath.resolveExisting` uses Node's asynchronous `fs.promises.realpath` to check existing targets against the canonical root. `resolveForWrite` permits missing destinations by finding the nearest existing ancestor with `lstat`, then validating its real path. The trusted root must exist. Filesystem errors propagate; dangling links and link chains are never reconstructed manually.
  3. Media reads, directory stats, ZIP entries, uploads, static assets, and generated photo/video/GPX cache access validate at filesystem boundaries. Cache checks use the existing `TempFolder`, so missing `tc`/`f` subdirectories can be created safely. Logical paths are retained to preserve in-gallery aliases and relative cache naming.
  4. Uploads use `fs.promises.open(..., 'wx')` and write through the returned handle. Cleanup only follows successful exclusive creation, closes the handle, and revalidates containment before unlinking.
- **Validation**: Focused tests cover lexical traversal, internal/external symlinks, missing destinations, chained/dangling links, symlinked roots, filesystem errors, static assets, cache-file symlinks, and upload cleanup. Local tests do not establish that GitHub's CodeQL alerts are closed; rerun the scan after publishing the changes.
- **Filesystem trust boundary**: These are preflight checks, not atomic protection against a local process replacing directories or symlinks between validation and use. Gallery, cache, and frontend directory topology must be controlled by trusted administrators. Uploads create regular files, not symlinks. `wx` prevents final-name replacement on supported filesystems but does not anchor parent-directory resolution. No third-party path or filesystem dependency is introduced.

#### Extension and metadata containment follow-up (2026-10-10)

Implemented locally on `hardening/extension-and-metadata-paths`; GitHub CodeQL verification is pending publication.

- Extension names must be a single folder component starting with an ASCII letter or digit, followed by letters, digits, dots, underscores or hyphens. Folder symlinks are rejected, including internal aliases, to prevent deletion or installation through an alias. Code/config/package files and `node_modules` are checked against their extension folder before use; directory modules and dangling links fail closed. Cleanup resolves `server.js` under the configured extension root.
- ZIP extraction continues to use the existing `adm-zip` extractor. Before extraction, every entry is checked for traversal, absolute/drive paths, backslashes, null bytes and special-file types. Node `mkdtemp` provides fresh download and extraction directories; downloads use exclusive creation. Extraction destinations are checked before moving staged files, and existing installation entries are not overwritten. Remove an existing extension before reinstalling it. Staging is cleaned on failure or success; hidden staging folders are excluded from extension discovery.
- Photo/video metadata source paths are checked against `ImageFolder`, and derived XMP sidecars receive independent containment checks. External or unreadable sidecars are skipped; contained source/sidecar aliases remain supported. Exclusion marker reads also stay within the gallery root.
- Reuses Node filesystem APIs, existing `SafePath` checks (with a synchronous equivalent for startup config loading), and the installed ZIP dependency. `ExtensionPath` centralizes extension-specific naming and entry-type policy; no new dependency is introduced. Extensions still execute trusted code and may install npm dependencies; this is filesystem containment, not an extension sandbox. The trusted-directory/TOCTOU limitation described above also applies here.
- Validation: Node 24 backend build passed; 161 focused tests passed across extension containment, metadata containment, existing filesystem/path containment, directory scanning, metadata parsing, and extension config loading. The repository ESLint configuration does not target these backend/test files; TypeScript compilation and focused tests provide the automated validation. Tests include malicious ZIP paths and links, linked module/config files, cleanup root resolution, normal flat/wrapped archives, sidecar aliases, destination protection, and failure cleanup. Existing guarded GPX/photo/static-file alert paths were reviewed and retained. Alert counts are not claimed resolved until a new GitHub scan confirms the result.

#### PR #33 review follow-up (2026-10-10)

- Bulk discovery skips and warns about invalid folder names, folder symlinks and invalid template files; direct install/reload/delete and single-template loading remain strict.
- Installation uses a non-recursive `mkdir` to record ownership. On failure it cleans partial extension registrations and its newly created folder/config entry, preserving pre-existing folders. Download/extraction staging is still cleaned. These lifecycle checks do not make the multi-file installation atomic or undo arbitrary effects of trusted extension code.
- Lexical containment now uses an inline normalized `path.relative` guard, matching CodeQL's documented sanitizer pattern; canonical symlink containment remains enforced. The extension allowlist is also explicit at folder construction. Metadata APIs document their existing absolute-path contract. Module-cache reload behavior is a separate pre-existing lifecycle issue.
- Validation: backend build and 168 focused tests passed, including unsafe discovery entries, template-link rejection, extraction/template/init failure cleanup and retry, partial-registration/template-cache cleanup, and preservation of existing installations. Scanner results and individual warning disposition must be checked after pushing the follow-up.

### 3.2 Authentication, Sessions & Identity (S1, S2, AUD1, AUD2, AUD6, AUD8, AUD12)

- **CSRF Protection & Cookies (S1)**: In `server.ts`, cookie sessions configured with `httpOnly: true`, `sameSite: 'lax'`, `signed: true`. Created `CSRFProtection.ts` issuing double-submit cookie `pigallery2-csrf-token` and validating `PI-GALLERY2-CSRF-TOKEN` / `X-CSRF-TOKEN` on mutating requests. Updated `NetworkService.ts` to supply header on all mutating frontend HTTP calls. (CodeQL alert #112 regarding plaintext CSRF cookie is an expected false positive under OWASP double-submit cookie architecture: the CSRF token cookie must be readable by frontend JavaScript to populate the header, while the authenticated session cookie itself is strictly `httpOnly: true, sameSite: 'lax', signed: true`).
- **Rate Limiting (S2)**: Created `RateLimiter.ts` implementing in-memory sliding-window request throttling (10 requests/minute per IP) on `/user/login`, `/share/:key/login`, and `/auth/oidc/callback`, responding with HTTP 429 and `Retry-After`.
- **Live Session Validation (AUD1)**: Added `validateExistingSession` in `AuthenticationMWs.ts`. Requests validate session user existence in database, role changes, permission modifications, and explicit expiry (`session.expires`). Share sessions verify share existence and non-expiration.
- **OIDC Identity Binding (AUD2)**: Added `oidcIssuer` and `oidcSubject` columns to `UserEntity.ts` and `UserDTO.ts`. In `OIDCAuthService.callback`, accounts are linked strictly by `(issuer, subject)`. Blocked automatic binding to privileged accounts (`Admin`, `Developer`). Enforced `email_verified` claim when domain restrictions are enabled.
- **Scrubbing Password Hashes (AUD6)**: Stripped `password` field in `SessionManager.buildContext`, `OIDCAuthService.callback`, and `UserMWs.updateSettings` so password hashes never enter readable session cookies.
- **Safe Admin Bootstrap (AUD8)**: Replaced default `admin/admin` credentials in `SQLConnection.init` with cryptographically random 16-character alphanumeric password generated via `crypto.randomBytes`, logged once on initial startup.
- **Asynchronous Password Processing (AUD12)**: Implemented non-blocking `cryptPasswordAsync` and `comparePasswordAsync` via bcrypt in `PasswordHelper.ts`. Converted user authentication and share login methods to asynchronous execution.

### 3.3 Sharing Access & Query Integrity (AUD3, AUD5, AUD13)

- **Access Query vs Display View Separation (AUD3)**: Separated `searchQuery` (authoritative access boundary) from `defaultSearchView` (initial UI presentation view) in `SharingEntity.ts`, `SharingDTO.ts`, and `SharingManager.ts`. In `SessionManager.buildAllowListForSharing`, permissions are strictly built from `searchQuery`, bounded by creator restrictions.
- **Bounded Share-Key Generation (AUD5)**: In `SharingMWs.createSharing`, corrected key availability check to `res == null`, added a 10-attempt retry limit, and enforced database-level uniqueness via `@Column({unique: true})` in `SharingEntity.ts`.
- **Share Query Filter Preservation (AUD13)**: In `SharingManager.listAllForQuery`, replaced `.where()` with `.andWhere()` when applying creator filters so search query expressions are not discarded.

#### Projection cache hashing (CodeQL #96, 2026-10-10)

Implemented on `hardening/projection-key-sha256`; publication and GitHub CodeQL verification are pending.

- **Assessment**: `SessionManager.createProjectionKey` fingerprints the canonical allow/block query, including restrictions built from sharing queries. It does not hash passwords or generate share-link tokens (those use bcrypt and cryptographic randomness). The identifier partitions permission-scoped memory and database caches. A collision could reuse album/person metadata or timeline aggregates across different scopes; no practical collision involving accepted search queries has been demonstrated. Direct media authorization separately checks the actual projection query.
- **Change and tradeoff**: Both query keys and `NO_PROJECTION_KEY` now use the first 32 hexadecimal characters of SHA-256. This retains 128 output bits, provides approximately 64-bit generic collision resistance, and avoids MD5's known structural weaknesses. It is intentionally a compatibility-preserving hardening measure, with less collision resistance than full SHA-256. Lowercase hexadecimal keeps existing database comparison behavior and all three `varchar(32)` cache columns. No schema migration or version bump is required.
- **Deployment and cache lifecycle**: Restart with the rebuilt backend. `ProjectedCacheManager.init()` recomputes active keys and deletes obsolete directory, album and person cache rows; new entries are populated on demand. Memory caches start empty. Existing signed sessions rebuild restricted projection contexts through the authentication middleware; unrestricted contexts can retain the old default identifier until a new context is built, causing temporary cache duplication rather than broader access. Passwords, sharing tokens and indexed media are preserved.
- **Validation**: Backend compilation and focused SQLite/MariaDB checks cover canonical query equivalence, distinct permission scopes, fixed SHA-256 vectors, 32-character output, and startup/repeated-startup cleanup of legacy keys from all three projected-cache tables. `npm run build-backend` passed on Node 24.21.0. The focused SessionManager, ProjectedCacheManager, AlbumManager, PersonManager, TimelineManager and SharingManager suites passed **120 tests across SQLite and MariaDB**. After adding the final query-vector assertion, compilation and the projection-key checks passed again (**4 tests**). The database run bypassed `test/setup-local.js` with `--no-config`, retained `test/root-hooks.cjs`, and used only the disposable `pigallery2_test` database. The MariaDB container was restored to its original stopped state. A local passing suite does not establish that GitHub alert #96 is closed.

### 3.4 Database Upgrades & Recovery (AUD4)

- **Non-Destructive Schema Updates**: Replaced destructive table drops on version mismatch with non-destructive schema synchronization. Schema upgrades, version checks, and SQLite backups are isolated in `DatabaseMigrations.ts`; `SQLConnection.ts` invokes them before exposing the connection to application queries.
- **OIDC Schema Migration (43 → 44)**: The hardening release added nullable `oidcIssuer` / `oidcSubject` columns without advancing version 43. Startup now upgrades existing version-43 databases by adding only missing columns and then saving version 44. This avoids general schema synchronization and preserves users, password hashes, permissions, shares, indexed media, and unrelated columns. SQLite applies both column additions and the version update in one transaction. Databases already containing either or both columns are supported. Older schemas retain the existing synchronization path; newer schema versions are rejected rather than downgraded.
- **Automatic SQLite Backup**: Creates a backup beside the database (`<database-file>.bak-<timestamp>-<random>`) before a schema upgrade, using the native SQLite backup API to include committed WAL contents. Backup failure aborts the upgrade before any schema changes. Failed SQLite migrations roll back, close the failed connection, and can be retried. Backups remain in the database volume; allow space for a full database copy when deploying this release.
- **Migration Regression Coverage**: `test/backend/integration/model/sql/typeorm.ts` covers real missing-column schemas at version 43, partially/already applied column additions, preservation of all table rows, backup contents including WAL data, repeated startup, backup failure, transaction rollback/retry, and refusal to downgrade a newer database.
- **Deployment**: Rebuild and deploy an image containing this change with the existing database volume mounted. Startup creates a private backup (mode `0600`), migrates the database before querying users, and logs `Migrated OIDC identity columns to database schema version 44`. Subsequent starts skip the migration. No manual SQL or database reset is required.
- **Read-Only Connection Checks**: `tryConnection()` now connects without executing schema sync or table modifications.

### 3.5 Uploads, Streams, Caching & Logging (S3, AUD7, AUD9, AUD10, AUD11, AUD14, B8)

- **Upload Concurrency & Race Handling (S3, AUD10)**: Added global concurrency semaphore (`MAX_CONCURRENT_UPLOADS = 5`) returning HTTP 429 when saturated. In `UploadManager.saveFile`, used atomic exclusive write flag `wx` (`fs.promises.open(..., 'wx')`) to prevent overwrite races, with automatic cleanup of partial files on failure. Upload limits retained at 50 MiB/file and 10 parts/request.
- **Explicit Caching Policy (AUD7)**: Set `Cache-Control: private, max-age=31536000, immutable` for protected media in `RenderingMWs.ts`; set `no-store, no-cache, must-revalidate` for sensitive configuration/user endpoints.
- **Secret Redaction (AUD9)**: Redacted passwords, secrets, client secrets, and tokens from diagnostic logs in `server.ts`; stripped credential parameters from request URLs in `LoggerRouter.ts`.
- **ZIP Stream Lifecycle (AUD11)**: In `GalleryMWs.zipDirectory`, added client disconnect listener (`res.on('close')` -> `archive.abort()`), `res.headersSent` guards, and SafePath validation on archive entries.
- **Metafile Policy (AUD14)**: Verified directory-level metafile authorization in `GalleryManager.authoriseMetaFile`: requires directory to contain matching projection media before granting access to directory metafiles.
- **SQLite LIKE Escaping (B8)**: Added SQLite `ESCAPE '\\'` clause to LIKE queries and escaped literal `_` and `%` characters during glob translation in `SearchManager.ts`.

### 3.6 Dependency Overrides & Tooling (Dependabot #5, S4)

- **Dependabot Alert #5 (`proxy-addr`)**: Pinned `"proxy-addr": "2.0.8"` via `package.json` overrides to eliminate IPv4-mapped IPv6 trust spoofing vulnerability. Confirmed via `npm ls proxy-addr`.
- **Audit Status**: Both production audit (`npm audit --omit=dev`) and full audit (`npm audit`) report **0 vulnerabilities**. Overrides and package upgrades eliminated 7 advisories; replacing Karma with Vitest (F6) eliminated the remaining 6 dev advisories (transitive `chokidar 3` → `braces`).
- **Build Tooling Follow-up (F5, 2026-10-08)**: `refactor/application-builder` replaces custom-webpack with `@angular/build` 22.2.1 and removes webpack package entries from the lockfile. Browser build/test file replacements preserve the private-config exclusion; browser dependency inspection found no backend module inputs. Build and release verification is recorded in [Techdebt.md](Techdebt.md#completed-application-builder-migration-2026-10-08).
- **Build Deprecation Elimination & Dependency Hardening (2026-10-08)**:
  - Upgraded `fast-xml-parser` to `5.11.2` in `dependencies`, resolving moderate XML comment/CDATA injection vulnerability (GHSA-gh4j-gqv2-49f6).
  - Upgraded `marked-katex-extension` to `5.1.13` and added override for `katex: 0.19.0`, resolving KaTeX prototype pollution advisory (GHSA-238p-pmpm-9mq7).
  - Added npm overrides for `diff: 8.0.3` (GHSA-73rr-hh4g-fpgx) and `serialize-javascript: 7.1.2` (GHSA-5c6j-r48x-rmvq, GHSA-qj8w-gfj5-8c6v).
  - Added npm override for `braces: 3.0.3` (GHSA-vfj7-8cjw-p6xm).
  - Added scoped npm overrides for `glob: 13.0.6` on `typeorm`, `archiver-utils`, and `mocha` to eliminate the upstream glob 10 deprecation warning.
  - Configured `allowScripts` in `package.json` covering all 8 verified native addon and installer packages (`@parcel/watcher`, `bcrypt`, `better-sqlite3`, `cypress`, `esbuild`, `ffmpeg-static`, `lmdb`, `msgpackr-extract`) to ensure clean execution under npm 11 and prepare for npm 12 execution policies (T7).
  - Eliminated `@angular/animations` by migrating lightbox transitions to native Web Animations API (`element.animate`), removing both `@angular/animations` and obsolete `@angular/platform-browser-dynamic` (F4). `npm ci` now completes with 0 deprecation and 0 install-script warnings.
- **Frontend Unit Testing Migration to Vitest (F6, 2026-10-08)**:
  - Replaced Karma and Jasmine with `@angular/build:unit-test` powered by Vitest 5 and JSDOM.
  - Removed deprecated `karma`, `karma-*`, `jasmine-core`, and `@types/jasmine`, completely eliminating the legacy `chokidar 3` / `braces` tree.
  - All 152 unit tests pass headlessly in 5.4s without browser binaries. Both production and development vulnerability audits report 0 vulnerabilities.
