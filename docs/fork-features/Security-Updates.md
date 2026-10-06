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

5. **Testing**:
   Add a dedicated security test suite `test/backend/unit/security/PathTraversal.spec.ts` testing payloads:
   - `../../../../etc/passwd`
   - `..%2f..%2f` (URL-encoded)
   - `folder/../../`
   - Windows backslashes `..\..\`
   - Null bytes `%00`

---

## 2. Other Planned Security Work

| Item | Area | Priority | Description |
|---|---|---|---|
| **S1** | **Cookie & CSRF Policy** | High | Define explicit `SameSite` (`Lax`/`Strict`) and `Secure` cookie attributes. Add CSRF token validation on mutable API endpoints (`POST`, `PUT`, `DELETE`). |
| **S2** | **Login & Callback Throttling** | High | Implement rate limiting / progressive backoff on `/user/login` and `/auth/oidc/callback` to prevent credential stuffing and brute force attempts. |
| **S3** | **Upload Memory Caps** | Medium | Multer currently buffers up to 50 MiB × 10 files in Node memory per request with no concurrency cap. Migrate to streaming disk storage or add a global concurrent-upload semaphore. |
| **S4** | **Tooling Dependency Vulnerabilities** | Medium | Audit remaining 30 devDependencies advisories in tooling/test packages (Webpack dev-server, Karma, Mocha, Cypress). `--omit=dev` remains 0. |

---

## 3. Audit

### 3.1 Scope & Status

Source review performed on **2026-10-06**, after the framework and runtime upgrades, on branch `fork-inclusion/pr-1165-preview-ceiling`. Reviewed authentication, OIDC, sharing, database initialization, uploads, media responses, logging, and the existing hardening/technical-debt plans.

These are findings from source inspection and the installed middleware implementations, not a new scanner report or a runtime exploit validation. Existing passing tests, lint, TypeScript checks, and Sonar results were accepted; none were rerun for this review. Exploitability conditions and policy decisions are identified below. All items remain open.

### 3.2 Access Control, Identity & Data Preservation

#### AUD1 — Existing sessions survive account and share revocation

**Priority: High**

**Where:** [AuthenticationMWs.authenticate / logout](../../src/backend/middlewares/user/AuthenticationMWs.ts), [UserMWs](../../src/backend/middlewares/user/UserMWs.ts).

An existing `req.session.context` is accepted without rechecking the database user or sharing link. Rebuilding a projection uses the user copied into the cookie. Deleting or demoting a user, changing their password or per-user restrictions, deleting a share, or letting a share expire does not invalidate an already-issued session. User-management operations only refresh or clear the requesting session when it belongs to the affected user.

The stored `req.session.expires` is never checked before a remembered session is extended. Logout removes the context from the current cookie but cannot revoke a previously copied cookie. `cookie-session` explicitly documents that it does not prevent replay or enforce server-side expiry: [middleware documentation](https://expressjs.com/en/resources/middleware/cookie-session/).

**Remediation:** Enforce expiry before extending sessions, refresh authorization from current user/share records, and introduce a revocation mechanism such as server-side sessions or an authoritative session version. Apply changes to roles, restrictions, passwords, and share validity to existing sessions.

#### AUD2 — OIDC identities are linked by mutable/non-unique names

**Priority: High when OIDC is enabled; exploitation depends on provider registration and username controls**

**Where:** [OIDCAuthService.callback](../../src/backend/middlewares/user/OIDCAuthService.ts).

The callback matches a local account by `preferred_username`, falling back to the email portion before `@`. An OIDC identity named `admin` selects an existing local administrator; identities with the same email local part can also collide. Disabling auto-creation does not prevent matching an existing account this way.

The domain allow-list is skipped when the email claim is missing, and `email_verified` is not checked. Consequently, a configured domain restriction does not consistently establish a verified identity in that domain.

**Remediation:** Explicitly link local accounts to the issuer and subject (`iss`, `sub`), with a deliberate account-linking/migration flow. When domain restrictions are enabled, reject missing/invalid email claims and require verification according to the provider's supported claim contract. The [OIDC specification](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability) defines issuer plus subject as the stable identity, rather than username or email.

#### AUD3 — A share's default view overwrites its access boundary

**Priority: High**

**Where:** [SharingManager.createSharing / updateSharing](../../src/backend/model/database/SharingManager.ts), [SessionManager.buildAllowListForSharing](../../src/backend/model/database/SessionManager.ts).

Both create and update assign `defaultSearchView` to `searchQuery`. The latter determines the recipient's access. A broader initial display query therefore broadens the share beyond its intended subset. The creator's own restrictions are still intersected with the share query, so this does not grant access beyond the creator's permissions.

**Remediation:** Keep the access query and initial display query separate. The default view must operate within the share's access boundary.

#### AUD4 — Schema upgrades discard persistent application data

**Priority: High technical/data-preservation risk**

**Where:** [SQLConnection.schemeSync / tryConnection](../../src/backend/model/database/SQLConnection.ts), [DataStructureVersion](../../src/common/DataStructureVersion.ts).

On a structure-version mismatch or missing version record, schema synchronization drops the database and restores only users. Shares, saved searches/albums, and extension tables are not preserved. If restoring users fails, the database is dropped again and initialization continues without those users. This affects database records, not original media files on disk.

Even `tryConnection()` invokes schema synchronization, so a connection check against an existing database can trigger the same destructive behavior.

**Remediation:** Introduce explicit migrations, backup/recovery behavior, and failure handling that preserves the original database. Make connection validation non-destructive. Establish this before adding persistent OIDC identity links or session records.

#### AUD5 — Share creation can loop indefinitely

**Priority: High operational priority**

**Where:** [SharingMWs.createSharing](../../src/backend/middlewares/SharingMWs.ts), [SharingManager.findOne](../../src/backend/model/database/SharingManager.ts).

The key-generation loop expects an unused key to make `findOne()` throw. However, the manager uses TypeORM's `getOne()`, which returns `null` when no row exists. The loop keeps generating keys and querying the database instead of creating the share; a database error is currently what breaks the loop.

The sharing router suite covers login rather than this creation path, so passing results do not validate the loop's termination.

**Remediation:** Break on a missing result, bound collision retries, propagate database errors, and enforce key uniqueness in the database.

#### AUD6 — Password hashes enter readable session cookies

**Priority: Medium**

**Where:** [OIDCAuthService.callback](../../src/backend/middlewares/user/OIDCAuthService.ts), [UserMWs.updateSettings](../../src/backend/middlewares/user/UserMWs.ts), [SessionManager.buildContext](../../src/backend/model/database/SessionManager.ts).

OIDC login and updates to the current user's settings pass a full user entity, including its password hash, into the session. Password login explicitly removes the hash, but these paths do not. `cookie-session` signs rather than encrypts session contents, making the hash readable from the cookie: [middleware documentation](https://expressjs.com/en/resources/middleware/cookie-session/).

**Remediation:** Use a minimal session DTO consistently across all authentication and user-update paths; never serialize password hashes into sessions.

#### AUD7 — Protected media receives public caching headers

**Priority: Medium; exposure depends on shared-cache/proxy configuration**

**Where:** [RenderingMWs.renderFile](../../src/backend/middlewares/RenderingMWs.ts).

The file renderer uses `sendFile()` without overriding its public caching policy. The installed implementation produces `Cache-Control: public, max-age=31536`, approximately **8.8 hours**; the configured `maxAge: 31536000` is in milliseconds. A shared cache configured to cache these responses could serve protected media without reaching authentication again.

**Remediation:** Define an explicit policy: `private` for protected media and `no-store` where required. Include sensitive API responses and personalized HTML in the caching review, and verify the deployment proxy's behavior.

#### AUD8 — Predictable administrator credentials are created automatically

**Priority: High on first startup or recovery when no administrator/developer exists**

**Where:** [SQLConnection.init](../../src/backend/model/database/SQLConnection.ts).

Initialization creates `admin/admin` whenever no administrator or developer exists and only displays a warning afterward. This can also occur after failed user restoration during a schema upgrade (AUD4).

**Remediation:** Require first-run setup or a generated one-time credential, including a deliberate recovery flow that does not silently restore a predictable password.

### 3.3 Additional Security & Reliability Findings

| Item | Finding | Priority | Evidence & Remediation |
|---|---|---|---|
| **AUD9** | Secrets in diagnostic logs | Medium; verbose/debug logging | [server.ts](../../src/backend/server.ts) serializes configuration without secret filtering. String truncation still exposes ordinary-length credentials. [LoggerRouter](../../src/backend/routes/LoggerRouter.ts) logs request URLs, including sharing keys and OIDC callback parameters. Redact sensitive configuration values and credential-bearing URL parameters. |
| **AUD10** | Upload overwrite race | Medium | [UploadManager.saveFile](../../src/backend/model/UploadManager.ts) checks existence and then writes separately. Concurrent uploads can both pass the check and overwrite each other. Use exclusive creation (`wx`) and define partial-file cleanup behavior. |
| **AUD11** | ZIP errors can terminate the process | Medium | [GalleryMWs.zipDirectory](../../src/backend/middlewares/GalleryMWs.ts) throws inside an asynchronous archive error listener. Handle stream errors through the request lifecycle; abort archive work when the client disconnects. |
| **AUD12** | Password verification blocks the event loop | Medium; extends S2 | [PasswordHelper](../../src/backend/model/PasswordHelper.ts) uses synchronous bcrypt hashing/comparison. Use asynchronous operations alongside login/share-login throttling to limit the effect of authentication traffic on other requests. |
| **AUD13** | Share listing loses its search-query filter | Medium correctness issue | [SharingManager.listAllForQuery](../../src/backend/model/database/SharingManager.ts) calls `.where()` again for the creator condition, replacing the query filter. Non-admin users receive all their own shares instead of only matching ones. Use `.andWhere()`; [TypeORM documentation](https://typeorm.io/docs/query-builder/select-query-builder/#adding-where-expression) confirms replacement behavior. |
| **AUD14** | Metafile access uses whole-directory permissions | Medium privacy/policy decision | [GalleryManager.authoriseMetaFile](../../src/backend/model/database/GalleryManager.ts) permits a directory's metafiles when any media there matches the projection; [SearchManager](../../src/backend/model/database/SearchManager.ts) also lists metafiles from matching media directories when enabled. Sharing one photograph can expose a GPX track or Markdown document in that folder. Decide and document whether this is intended; otherwise introduce explicit metafile sharing permissions. |

### 3.4 Corrections & Constraints for Existing Plans

- **Path containment:** The proposed `SafePath` helper in Section 1.3 checks lexical containment, not symlink containment. Define whether links outside the media root are permitted and enforce that policy consistently. Preserve the gallery-root convention: several callers represent the root as `/`, which cannot be passed unchanged to `path.resolve(baseDir, untrustedPath)` as a relative path.
- **Historical scanner inventory:** Section 1.2 records a historical scan, not 19 individually confirmed exploitable vulnerabilities in the current checkout. It references `saveUploadedFile` and rename operations that no longer exist in the current upload implementation. Refresh the inventory against the implementation during remediation.
- **Zoneless provider:** Techdebt item A1 should use stable `provideZonelessChangeDetection()`, available since Angular 20.2, rather than the experimental provider: [Angular documentation](https://angular.dev/api/core/provideZonelessChangeDetection).
- **Performance estimates:** Build-time improvements in the modernization plan should remain estimates until measured on this project.

These observations are recorded here for follow-up; this audit addition does not rewrite the historical scanner section or Techdebt.md.

### 3.5 Suggested Order of Work

1. Fix the sharing defects (AUD3, AUD5, AUD13), remove sensitive session fields (AUD6), and redact secrets (AUD9).
2. Establish safe database migrations and recovery (AUD4) before introducing persistent identity/session records; replace predictable administrator bootstrap credentials (AUD8).
3. Address S5 path containment together with session/OIDC hardening (AUD1–AUD2) and the existing cookie/CSRF and throttling plans (S1–S2).
4. Complete caching, upload, stream, password-processing, and metafile-policy work (AUD7, AUD10–AUD12, AUD14), alongside S3 upload resource limits.
5. Continue low-risk dependency removals and the `mysql2` switch, followed by animation removal and builder/test modernization. Schedule zoneless work after the security and data-preservation changes.
