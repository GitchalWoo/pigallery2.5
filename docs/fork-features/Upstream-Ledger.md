# Upstream Commit Ledger (`bpatrik/pigallery2`)

Ever-growing ledger tracking upstream commits and pull requests from [bpatrik/pigallery2](https://github.com/bpatrik/pigallery2) since the fork's common ancestor (`dc456950`, 2026-08-25). See [Upstream-Porting.md](Upstream-Porting.md) for porting rules, conflict guidelines, and testing requirements.

- **Common ancestor:** `dc456950` (2026-08-25)
- **Last surveyed upstream commit:** `c36b1fdc` (2026-11-21)

Run `node scripts/upstream-status.mjs --fetch` to list any new upstream commits arrived since the last surveyed commit.

---

## Ported

| Upstream PR / Commit | Summary | Fork PR | Notes |
| --- | --- | --- | --- |
| [#1206](https://github.com/bpatrik/pigallery2/pull/1206) | Guest-role cleanup; configurable role for OIDC auto-created users | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Kept fork OIDC account linking; role constraint accepts `undefined` for frontend typeconfig. |
| [#1207](https://github.com/bpatrik/pigallery2/pull/1207) | Navbar search link without query no longer breaks routing | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Fork version skips to next navbar link; added Vitest spec. |
| [#1210](https://github.com/bpatrik/pigallery2/pull/1210) | Lightbox releases scroll lock when destroyed while open | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Adapted to fork's Web Animations API lightbox. |
| [#1358](https://github.com/bpatrik/pigallery2/pull/1358) | Search matches names with double spaces | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | |
| [#1375](https://github.com/bpatrik/pigallery2/pull/1375) | Random links accept shortened query format and start from shown folder | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Frontend adapted to fork component style; added Vitest + `GalleryRouter.spec.ts` coverage. |
| [#1382](https://github.com/bpatrik/pigallery2/pull/1382) | Backslash escaping in search; CodeQL config; nginx API rate limit | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Other CodeQL fixes already in fork. |
| [#1270](https://github.com/bpatrik/pigallery2/pull/1270) | Fall back to full-file exifr read when chunked read fails near 64 KiB XMP | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Preserved fork's RAW preview extraction. |
| [#1409](https://github.com/bpatrik/pigallery2/pull/1409) | Close exifr file handle on parse error (empty/1-byte photos) | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | |
| [#1404](https://github.com/bpatrik/pigallery2/pull/1404) | Negated ranges, whole-day dates, decimal searches; `=`/`!=` in query builder | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Query builder adapted to fork component; added Vitest spec. |
| [#1385](https://github.com/bpatrik/pigallery2/pull/1385) *(partial)* | Uploads never create folders; "already exists" error hides disk path | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Adapted onto `SafePath` uploader; route-level folder-access check deferred until `#1205`. |
| [#1413](https://github.com/bpatrik/pigallery2/pull/1413) | Escape user input in failed-login logs; warn on untrusted reverse proxy; Fail2Ban guide | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Also fixed null sharing dereference on unknown share key; skipped `.xlf`-churning `trustProxy` text reword. |
| `cf82bd04` | Case-insensitive nginx login rate limit, TLS 1.2+, client IP forwarding, security headers | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Kept `55m` buffered upload limit until `#1378` is ported. |
| [#1212](https://github.com/bpatrik/pigallery2/pull/1212) (`22088d3a`, `c363b088`) | Revalidate cookie sessions against DB with cached HMAC stamps; enforce `Server.sessionTimeout`; start sessions only in `AuthenticationMWs` (`OIDCMWs`, `refreshSession`) | [#42](https://github.com/GitchalWoo/pigallery2.5/pull/42) *(open)* | Kept signed/CSRF cookies, SHA-256 projection keys, `RateLimiter`, `AUD2` OIDC binding; omitted `#1205` `DirectoryAccess` and `unlinkOidc`. Closes session-revocation finding in [Public-Exposure-Audit-2026-10-10.md](Public-Exposure-Audit-2026-10-10.md). |

---

## Planned (Queued in Priority Order)

| Order | Upstream PR / Commits | Summary | Effort | Notes for This Fork |
| --- | --- | --- | --- | --- |
| 1 | [#1400](https://github.com/bpatrik/pigallery2/pull/1400) (`cc4e220e`, `a5b99924`) | Role escalation & album rights: nobody grants a role above their own or edits a higher-role user; server checks `Album.readAccessMinRole` when listing albums (also covers album-delete IDOR #1173) | M | **User decision: security fixes only** (omit optional `Album.writeAccessMinRole` album-creation feature for normal users). Port `cc4e220e` and `a5b99924` as adapted commits. |
| 2 | [#1418](https://github.com/bpatrik/pigallery2/pull/1418) (`4b416523`, `0b72047c`) | Info panel map shows a styled pin even before folder map loads, and recenters when switching photos | S | Fork's info panel binds center only via `leafletOptions`, so the bug applies. Replace upstream Playwright tests with a Vitest spec. |
| 3 | [#1414](https://github.com/bpatrik/pigallery2/pull/1414) (`d80050bb`) | `Server.Log.file`: optional log file rotated at 10 MB for Fail2Ban on hosts without journald | S | Completes Fail2Ban support from `#1413`. Check `ConfigDiagnostics` and Docker data paths; file must stay inside configured data folder. |
| 4 | [#1378](https://github.com/bpatrik/pigallery2/pull/1378) (`4ebb11e5`, `b22d438a`, `6d52e24d`, `9c3e7e2b`) | Uploads stream to temp folder instead of RAM; `Upload.maxFileSizeMB` / `blockedExtensions`; uploader names rejected files & offers retry | M–L | Keep `SafePath` writes, `wx` exclusive creation, concurrency limit, 50 MiB default, and PR #41 `DirectoryNotFound` handling. Afterwards update nginx/NPM guides to `500m` + `proxy_request_buffering off` (`6d52e24d`). |
| 5 | [#1205](https://github.com/bpatrik/pigallery2/pull/1205) (`2615d2a5`, `4d5a77ba`, `39ce8072`, `0583c8c8`) | Folder sharing with password/expiry; per-user `allowDirectoryList` / `blockDirectoryList`; `DIRECTORY_NOT_FOUND`, `req.directoryAccess`, `authoriseDirectory` | L | Plan as its own step. Drop upstream SQLite LIKE escaping (fork already has its own). Unblocks the Deferred items below. |
| 6 | [#1384](https://github.com/bpatrik/pigallery2/pull/1384) | Closing the lightbox goes back in browser history | M | Must verify Timeline Back / scroll restore in a visible browser tab. |
| 7 | [#1369](https://github.com/bpatrik/pigallery2/pull/1369), [#1394](https://github.com/bpatrik/pigallery2/pull/1394)–[#1397](https://github.com/bpatrik/pigallery2/pull/1397) | Date label next to scrollbar; smooth virtual scrolling of huge grids | L | Port as one cohesive step after `#1384`, with Timeline regression checks. |
| 8 | [#1198](https://github.com/bpatrik/pigallery2/pull/1198), [#1380](https://github.com/bpatrik/pigallery2/pull/1380) | Sort/group by directory; accent-insensitive SQLite search | M each | `#1380` is off by default (slower SQLite); `#1198` needs Timeline grouping check. |
| 9 | [#1371](https://github.com/bpatrik/pigallery2/pull/1371)–[#1381](https://github.com/bpatrik/pigallery2/pull/1381) *(selective)* | UX fixes found by upstream e2e tests | M | Cherry-pick individual commits, not whole PRs: deep-link redirect after login & "session ended" banner (`#1372`), album delete confirmation (`#1379`), zip named after folder (`#1381`). |

---

## Deferred (Waiting on Dependencies)

| Upstream PR / Commit | Summary | Blocked By |
| --- | --- | --- |
| [#1392](https://github.com/bpatrik/pigallery2/pull/1392) (`251d002f`) | Prevent downloading option on shares | `#1205` |
| [#1383](https://github.com/bpatrik/pigallery2/pull/1383) | Accent-aware directory allow/block lists | `#1205` |
| [#1374](https://github.com/bpatrik/pigallery2/pull/1374) *(sharing fixes)* | Folder sharing edge-case fixes | `#1205` |
| `32d5d33f` | Stop calling `AuthenticationMWs` from `GalleryMWs.listDirectory` | `#1205` |
| [#1385](https://github.com/bpatrik/pigallery2/pull/1385) *(upload route check)* | Route-level `authoriseDirectory` check on uploads | `#1205` |

---

## Obsolete / Skipped

Items reviewed and intentionally **not** ported (so future sweeps do not re-evaluate them):

| Upstream PR / Commits | Reason Skipped / Obsolete |
| --- | --- |
| [#1300](https://github.com/bpatrik/pigallery2/pull/1300) | Path traversal & CodeQL path fixes — already covered more strictly by fork's `SafePath` and `ExtensionPath`. |
| [#1402](https://github.com/bpatrik/pigallery2/pull/1402) (`c9e80397`) | Logs `admin`/`admin` login hint after DB rebuild — wrong for this fork, which generates a random password in `admin-bootstrap.txt` and uses `DatabaseMigrations`. |
| [#1400](https://github.com/bpatrik/pigallery2/pull/1400) *(optional album-creation commits)* | Optional `Album.writeAccessMinRole` feature for normal users — skipped by user decision; security commits (`cc4e220e`, `a5b99924`) remain in **Planned**. |
| [#1410](https://github.com/bpatrik/pigallery2/pull/1410) | Upstream modern theme — fork has its own Prism 2026 design system. |
| [#1401](https://github.com/bpatrik/pigallery2/pull/1401) | Upstream About page & "What's new" admin popup — upstream branding/release-notes specific. |
| `#1220`, `#1221`, `#1251`–`#1274`, `#1287`–`#1294`, `#1289`, `#1291` | Upstream Angular 20–22, zoneless, Express 5, `openid-client` 6, TypeORM 1, Node 26, Gulp, Playwright, and lint modernization phases — fork modernized independently on Node 24, `@angular/build` + Vitest + Cypress, native Node scripts in `scripts/`. |
| `#1166` (`8e5e99c9`) | Drop malformed GPS NaN — already present in fork (`PR #11`). |
| `#1389`, `#1398`, `#1403`, `#1411`, `#1415`, `#1419`, translation-only & release-checklist commits | Upstream release tooling, Playwright e2e media, docs screenshots/GIFs, and `.xlf` regeneration. |
