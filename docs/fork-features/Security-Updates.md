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
