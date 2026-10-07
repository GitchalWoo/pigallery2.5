# Security Updates & Hardening Plan

This document tracks security findings, automated scanner alerts (e.g., CodeQL), and planned remediation work for the fork.

---

## 1. CodeQL Path Traversal (CWE-22 / `js/path-injection`)

### 1.1 Context & Discovery
During the **Step 7 (Express 5)** upgrade, GitHub Advanced Security CodeQL scan (check run `112487991352` on PR #9) flagged **19 high-severity alerts** for:
> **"Uncontrolled data used in path expression"** (`js/path-injection`)

#### Root Cause Analysis
- **Pre-existing Code**: The underlying data flows (passing `req.params.directory` or `req.params.file` to `path.join(ProjectPath.ImageFolder, ...)` and `fs.stat`) have existed in upstream PiGallery2 for years. 14 of the 19 alerts are in files completely untouched by the Express 5 upgrade (`UploadManager`, `GPXProcessing`, `PhotoProcessing`, `GalleryManager`, `MetaFileMWs`, `RenderingMWs`).
- **Why Flagged in Step 7**: Express 4 routes previously used non-standard `:directory(*)` inline regex syntax, which CodeQL's taint engine did not model as standard named parameter sources. Modernizing routes to standard `RegExp` named capture groups `(?<directory>.*)` allowed CodeQL's parser to recognize `req.params.directory` as an untrusted HTTP input source, tracing taint across the backend call tree.
- **Sanitization Gap**: `AuthenticationMWs.normalizePathParam` currently uses `path.normalize(val).replace(/^(\.\.[\/\\])+/, '')`. CodeQL does not consider regex stripping or `path.normalize` a safe sanitizer because it does not strictly prove that the resolved path stays within the base directory root.

---

### 1.2 Alert Inventory (19 Locations)

| # | File | Line | Operation | Sink Description |
|---|---|---|---|---|
| **1** | `src/backend/middlewares/GalleryMWs.ts` | 75 | `fsp.stat` | `listDirectory`: directory stat check |
| **2** | `src/backend/middlewares/GalleryMWs.ts` | 330 | `fsp.stat` | `zipDirectory`: directory stat check |
| **3** | `src/backend/middlewares/GalleryMWs.ts` | 362 | `archiver` | `zipDirectory`: archiver file packaging |
| **4** | `src/backend/middlewares/MetaFileMWs.ts` | 29 | `fs.existsSync` | `compressService`: check converted metafile exists |
| **5** | `src/backend/middlewares/RenderingMWs.ts` | 95 | `fs.existsSync` | `renderFile`: check file existence |
| **6** | `src/backend/model/UploadManager.ts` | 28 | `path.join` / `fs` | `saveFiles`: destination directory resolution |
| **7** | `src/backend/model/UploadManager.ts` | 61 | `path.join` / `fs` | `saveUploadedFile`: target directory creation |
| **8** | `src/backend/model/UploadManager.ts` | 65 | `fs.existsSync` | `saveUploadedFile`: collision check |
| **9** | `src/backend/model/UploadManager.ts` | 66 | `fs.rename` | `saveUploadedFile`: move uploaded file |
| **10** | `src/backend/model/UploadManager.ts` | 69 | `fs.rename` | `saveUploadedFile`: backup duplicate file |
| **11** | `src/backend/model/database/GalleryManager.ts` | 63 | `path.join` | `listDirectory`: image folder path resolution |
| **12** | `src/backend/model/fileaccess/fileprocessing/GPXProcessing.ts` | 80 | `fs.readFileSync` | `loadGPXFile`: load track file from disk |
| **13** | `src/backend/model/fileaccess/fileprocessing/GPXProcessing.ts` | 89 | `fs.existsSync` | `compressGPX`: check existing converted file |
| **14** | `src/backend/model/fileaccess/fileprocessing/GPXProcessing.ts` | 90 | `fs.readFileSync` | `compressGPX`: read converted track file |
| **15** | `src/backend/model/fileaccess/fileprocessing/GPXProcessing.ts` | 168 | `fs.writeFileSync` | `compressGPX`: save compressed GPX file |
| **16** | `src/backend/model/fileaccess/fileprocessing/PhotoProcessing.ts` | 272 | `fs.existsSync` | `generateConvertedPath`: check converted image |
| **17** | `src/backend/model/fileaccess/fileprocessing/PhotoProcessing.ts` | 294 | `fs.existsSync` | `generateConvertedPath`: check cached derivative |
| **18** | `src/backend/routes/PublicRouter.ts` | 325 | `fs.existsSync` | `renderFile`: check frontend static file exists |
| **19** | `src/backend/routes/PublicRouter.ts` | 328 | `res.sendFile` | `renderFile`: send frontend asset |

---

### 1.3 Remediation Strategy

To permanently resolve these 19 alerts and prevent directory traversal:

1. **Centralized Safe Path Resolver**:
   Create a dedicated helper `src/backend/model/fileaccess/SafePath.ts`:
   ```ts
   import * as path from 'path';

   export class SafePath {
     /**
      * Resolves an untrusted relative path against an allowed base directory.
      * Throws or returns null if the target escapes the base directory.
      */
     public static resolve(baseDir: string, untrustedPath: string): string {
       const safeBase = path.resolve(baseDir);
       const target = path.resolve(safeBase, untrustedPath);
       
       // Ensure resolved path starts strictly with base directory + separator
       if (!target.startsWith(safeBase + path.sep) && target !== safeBase) {
         throw new Error(`Path traversal detected: attempt to escape base directory`);
       }
       return target;
     }
   }
   ```
   *Note: Using `path.resolve` followed by `.startsWith(base + path.sep)` is CodeQL's recognized sanitization guard pattern for CWE-22.*

2. **Middleware Sanitization**:
   Update `AuthenticationMWs.normalizePathParam` to validate parameters strictly against traversal before continuing down the middleware chain, returning `400 Bad Request` or `403 Forbidden` if escape is detected.

3. **Refactor Sinks**:
   Replace manual `path.join(ProjectPath.ImageFolder, directory)` in `GalleryMWs`, `UploadManager`, `PhotoProcessing`, and `GPXProcessing` with `SafePath.resolve(...)`.

4. **PublicRouter Asset Guard**:
   In `PublicRouter.renderFile`, ensure `req.params.file` is validated with `SafePath.resolve(frontendDir, file)` and reject any path containing separators (`/` or `\`).

5. **Testing & Resolution**:
   Added dedicated security test suite `test/backend/unit/security/PathTraversal.spec.ts` testing payloads:
   - `../../../../etc/passwd`
   - `..%2f..%2f` (URL-encoded)
   - `folder/../../`
   - Windows backslashes `..\..\`
   - Null bytes `%00`

   **Status: Resolved in Batch 1 (2026-10-07)**. Centralized `SafePath.resolve` implemented in `src/backend/model/fileaccess/SafePath.ts` and integrated across all sinks, `AuthenticationMWs.normalizePathParam`, and `PublicRouter.renderFile`. All 8 PathTraversal tests pass.

---

## 2. Other Planned Security Work

| Item | Area | Priority | Status / Description |
|---|---|---|---|
| **S1** | **Cookie & CSRF Policy** | High | **Closed (2026-10-07)**: Defined explicit `SameSite=Lax`, `HttpOnly=true`, and `signed=true` cookie attributes. Added double-submit CSRF token validation (`pigallery2-csrf-token`) on mutating API endpoints (`POST`, `PUT`, `DELETE`). |
| **S2** | **Login & Callback Throttling** | High | **Closed (2026-10-07)**: Implemented in-memory sliding window rate limiting (`RateLimiter.ts`) on `/user/login`, `/share/:key/login`, and `/auth/oidc/callback` (10 req/min limit, returning HTTP 429 with `Retry-After`). |
| **S3** | **Upload Memory Caps** | Medium | **Closed (2026-10-07)**: Added global upload concurrency semaphore (`MAX_CONCURRENT_UPLOADS = 5`) rejecting excess uploads with HTTP 429. Upload limits retained at 50 MiB/file and 10 parts/request. |
| **S4** | **Tooling Dependency Vulnerabilities** | Medium | **In Progress**: Pinned `proxy-addr: 2.0.8` via npm override to resolve Dependabot advisory #5 (IPv4-mapped IPv6 spoofing). Production dependencies report 0 vulnerabilities (`npm audit --omit=dev`). Remaining 30 advisories are isolated in devDependencies/tooling. |
| **S5** | **Path Traversal / CodeQL CWE-22 (19 alerts)** | High | **Closed (2026-10-07)**: Resolved via `SafePath.ts` integration across all media/file sinks, route parameter sanitization, and PublicRouter asset guard. |

---

## 3. Audit

### 3.1 Scope & Status

Source review performed on **2026-10-06**, after the framework and runtime upgrades, on branch `fork-inclusion/pr-1165-preview-ceiling`. Reviewed authentication, OIDC, sharing, database initialization, uploads, media responses, logging, and the existing hardening/technical-debt plans.

**Status as of 2026-10-07**: All findings (**AUD1–AUD14**) have been addressed and resolved on branch `hardening/application` with full regression coverage across both SQLite and MariaDB databases.

### 3.2 Access Control, Identity & Data Preservation

#### AUD1 — Existing sessions survive account and share revocation

**Priority: High** — **Status: Resolved in Batch 1 (2026-10-07)**

**Where:** [AuthenticationMWs.authenticate / logout](../../src/backend/middlewares/user/AuthenticationMWs.ts), [UserMWs](../../src/backend/middlewares/user/UserMWs.ts).

An existing `req.session.context` was previously accepted without rechecking the database user or sharing link.

**Resolution:** Implemented `validateExistingSession` in `AuthenticationMWs.ts`. It authoritatively checks existing session records against the live database state:
- Verifies that session has not expired (`session.expires`).
- Verifies user exists in the database and their role/permissions have not changed.
- If user permissions or restrictions changed, updates the session projection context accordingly; if user was deleted or disabled, clears session.
- For share sessions, verifies that the sharing link still exists, has not expired, and matches the session parameters.
- Validated with 4 unit tests in `test/backend/unit/middlewares/user/AuthenticationMWs.spec.ts`.

#### AUD2 — OIDC identities are linked by mutable/non-unique names

**Priority: High when OIDC is enabled** — **Status: Resolved in Batch 1 (2026-10-07)**

**Where:** [OIDCAuthService.callback](../../src/backend/middlewares/user/OIDCAuthService.ts).

The callback previously matched local accounts by `preferred_username` or email prefix, allowing collision or takeover.

**Resolution:**
- Added persistent `oidcIssuer` and `oidcSubject` columns to `UserEntity.ts` and `UserDTO.ts`.
- `OIDCAuthService.callback` now strictly links accounts by `(issuer, subject)`.
- If an unlinked account matches the username, automatic linking is blocked for privileged accounts (`Admin`, `Developer`) to prevent takeover.
- Enforced `email_verified` check whenever `allowedDomains` is configured.
- Tested and verified against RS256 JWKS mock OIDC provider in `OIDCRouter.spec.ts` and `OIDCAuthService.spec.ts`.

#### AUD3 — A share's default view overwrites its access boundary

**Priority: High** — **Status: Resolved in Batch 1 (2026-10-07)**

**Where:** [SharingManager.createSharing / updateSharing](../../src/backend/model/database/SharingManager.ts), [SessionManager.buildAllowListForSharing](../../src/backend/model/database/SessionManager.ts).

Both create and update previously assigned `defaultSearchView` to `searchQuery`, which determines access bounds.

**Resolution:** Separated `searchQuery` (access boundary) from `defaultSearchView` (initial presentation/UI query) in `SharingEntity.ts`, `SharingDTO.ts`, and `SharingManager.ts`. In `SessionManager.buildAllowListForSharing`, the allow-list is strictly constructed from `searchQuery`, bounded by the creator's permissions. Covered by unit tests in `SessionManager.spec.ts`.

#### AUD4 — Schema upgrades discard persistent application data

**Priority: High technical/data-preservation risk** — **Status: Resolved in Batch 1 (2026-10-07)**

**Where:** [SQLConnection.schemeSync / tryConnection](../../src/backend/model/database/SQLConnection.ts), [DataStructureVersion](../../src/common/DataStructureVersion.ts).

On structure-version mismatch, schema synchronization previously dropped all tables, losing shares, albums, and extensions.

**Resolution:**
- Replaced destructive table dropping with non-destructive schema update.
- Added automatic timestamped SQLite database backup (`sqlite.db.bak-<timestamp>`) before schema synchronization runs.
- Made `tryConnection()` read-only, avoiding schema synchronization or table alteration during connection testing.
- Covered by unit tests in `test/backend/unit/model/sql/SQLConnection.spec.ts`.

#### AUD5 — Share creation can loop indefinitely

**Priority: High operational priority** — **Status: Resolved in Batch 1 (2026-10-07)**

**Where:** [SharingMWs.createSharing](../../src/backend/middlewares/SharingMWs.ts), [SharingManager.findOne](../../src/backend/model/database/SharingManager.ts).

The key-generation loop previously relied on `findOne()` throwing to detect an unused key, but `getOne()` returns `null`.

**Resolution:**
- Explicitly check `res == null` to confirm key availability.
- Bounded retry loop to 10 attempts maximum with informative error propagation on exhaustion.
- Enforced unique constraint on `sharingKey` at database level with `@Column({unique: true})` in `SharingEntity.ts`.
- Covered by unit test in `test/backend/unit/middlewares/SharingMWs.spec.ts`.

#### AUD6 — Password hashes enter readable session cookies

**Priority: Medium** — **Status: Resolved in Batch 1 (2026-10-07)**

**Where:** [OIDCAuthService.callback](../../src/backend/middlewares/user/OIDCAuthService.ts), [UserMWs.updateSettings](../../src/backend/middlewares/user/UserMWs.ts), [SessionManager.buildContext](../../src/backend/model/database/SessionManager.ts).

Password hashes entered signed (unencrypted) session cookies in several authentication and user-update flows.

**Resolution:** Stripped `password` hash field across all session context builders (`SessionManager.buildContext`, `OIDCAuthService.callback`, and `UserMWs.updateSettings`). Verified by assertions in `SessionManager.spec.ts` and `UserManager.spec.ts`.

#### AUD7 — Protected media receives public caching headers

**Priority: Medium** — **Status: Resolved in Batch 1 (2026-10-07)**

**Where:** [RenderingMWs.renderFile](../../src/backend/middlewares/RenderingMWs.ts).

The file renderer previously used `sendFile()` without overriding its public caching policy.

**Resolution:**
- Set `Cache-Control: private, max-age=31536000, immutable` for protected media responses to prevent shared/intermediate proxy caching.
- Set `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` for sensitive API configuration and user endpoints.

#### AUD8 — Predictable administrator credentials are created automatically

**Priority: High** — **Status: Resolved in Batch 1 (2026-10-07)**

**Where:** [SQLConnection.init](../../src/backend/model/database/SQLConnection.ts).

Initialization previously created `admin/admin` automatically whenever no administrator account existed.

**Resolution:**
- Replaced hardcoded credentials with a cryptographically secure, random 16-character alphanumeric password generated via `crypto.randomBytes`.
- The bootstrap password is logged to standard output once on initial creation with instructions to change it upon first login.
- Verified with unit tests in `test/backend/unit/model/sql/SQLConnection.spec.ts`.

### 3.3 Additional Security & Reliability Findings

| Item | Finding | Priority | Status / Evidence & Remediation |
|---|---|---|---|
| **AUD9** | Secrets in diagnostic logs | Medium | **Closed (2026-10-07)**: Redacted sensitive configuration keys (passwords, secrets, client secrets, tokens) in diagnostic startup logging (`server.ts`). Sanitized credential-bearing request URL parameters in `LoggerRouter.ts`. |
| **AUD10** | Upload overwrite race | Medium | **Closed (2026-10-07)**: Implemented atomic exclusive creation (`wx` flag) in `UploadManager.saveFile` to prevent concurrent overwrite races. Added cleanup unlinking partial files upon write errors. Tested in `UploadManager.spec.ts`. |
| **AUD11** | ZIP errors can terminate the process | Medium | **Closed (2026-10-07)**: In `GalleryMWs.zipDirectory`, added client disconnect listener (`res.on('close')` -> `archive.abort()`), `res.headersSent` guards, and `SafePath.resolve` validation on all archived file entries. |
| **AUD12** | Password verification blocks the event loop | Medium | **Closed (2026-10-07)**: Added `cryptPasswordAsync` and `comparePasswordAsync` via bcrypt in `PasswordHelper.ts`. Converted user authentication, share login, and user management to non-blocking async execution. Tested in `PasswordHelper.spec.ts`. |
| **AUD13** | Share listing loses its search-query filter | Medium | **Closed (2026-10-07)**: In `SharingManager.listAllForQuery`, replaced `.where()` with `.andWhere()` for creator filter to preserve existing search-query expressions. Tested in `SharingManager.spec.ts`. |
| **AUD14** | Metafile access uses whole-directory permissions | Medium | **Closed (2026-10-07)**: Documented and verified directory authorization policy in `GalleryManager.authoriseMetaFile`. Ensures directory has matching projection media before granting access to directory metafiles. Tested in `GalleryManager.spec.ts`. |

### 3.4 Corrections & Constraints for Existing Plans

- **Path containment:** The proposed `SafePath` helper in Section 1.3 checks lexical containment, not symlink containment. Define whether links outside the media root are permitted and enforce that policy consistently. Preserve the gallery-root convention: several callers represent the root as `/`, which cannot be passed unchanged to `path.resolve(baseDir, untrustedPath)` as a relative path.
- **Historical scanner inventory:** Section 1.2 records a historical scan, not 19 individually confirmed exploitable vulnerabilities in the current checkout. It references `saveUploadedFile` and rename operations that no longer exist in the current upload implementation. Refresh the inventory against the implementation during remediation.
- **Zoneless provider:** Techdebt item A1 should use stable `provideZonelessChangeDetection()`, available since Angular 20.2, rather than the experimental provider: [Angular documentation](https://angular.dev/api/core/provideZonelessChangeDetection).
- **Performance estimates:** Build-time improvements in the modernization plan should remain estimates until measured on this project.

These observations are recorded here for follow-up; this audit addition does not rewrite the historical scanner section or Techdebt.md.

### 3.5 Implementation Status

Batch 1 (Application Hardening) has been fully implemented on branch `hardening/application` (2026-10-07):
1. **Sharing & Presentation Isolation**: Fixed AUD3 (searchQuery vs defaultSearchView separation), AUD5 (bounded key loop, DB uniqueness), AUD13 (query preservation with creator filter), AUD6 (scrubbed session hashes), AUD9 (redacted secrets in logs and URLs), and B8 (SQLite LIKE escape clause).
2. **Database & Bootstrap Safety**: Implemented AUD4 (non-destructive schema updates, pre-upgrade SQLite backup, read-only tryConnection) and AUD8 (cryptographic random admin password generation).
3. **Perimeter Controls & Identity**: Implemented S1 (CSRF protection, secure cookie flags), S2 (sliding-window rate limiting), S5 (SafePath containment across all sinks), AUD1 (session revocation and live database validation), and AUD2 (OIDC issuer/subject binding, collision prevention, email_verified requirement).
4. **Resources, Streams, Caching & File Safety**: Implemented S3 (concurrency semaphore), AUD7 (explicit private/no-store caching headers), AUD10 (atomic wx upload writes, partial file cleanup), AUD11 (ZIP stream disconnect abort and headers guards), AUD12 (async bcrypt hashing/comparison), and AUD14 (metafile authorization policy).
5. **Dependency Overrides**: Pinned `proxy-addr: 2.0.8` to resolve Dependabot advisory #5. Production dependencies report 0 vulnerabilities (`npm audit --omit=dev`).
