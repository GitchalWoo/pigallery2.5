# Upstream Commit Ledger (`bpatrik/pigallery2`)

Ever-growing ledger tracking upstream commits and pull requests from [bpatrik/pigallery2](https://github.com/bpatrik/pigallery2) since the fork's common ancestor (`dc456950`, 2026-08-25). See [Upstream-Porting.md](Upstream-Porting.md) for porting rules, conflict guidelines, and testing requirements.

- **Common ancestor:** `dc456950` (2026-08-25)
- **Last surveyed upstream commit:** `c36b1fdc` (2026-11-21)

Run `node scripts/upstream-status.mjs --fetch` to list new upstream commits. Before merging a ledger update, run `node scripts/upstream-status.mjs --fetch --check` to verify the watermark, PR entries, direct commit references and individual hashes in the selective PR table.

---

## Ported

| Upstream PR / Commit | Summary | Fork PR | Notes |
| --- | --- | --- | --- |
| [#1206](https://github.com/bpatrik/pigallery2/pull/1206) | Guest-role cleanup; configurable role for OIDC auto-created users | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Kept fork OIDC account linking; role constraint accepts `undefined` for frontend typeconfig. |
| [#1207](https://github.com/bpatrik/pigallery2/pull/1207) | Navbar search link without query no longer breaks routing | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Fork version skips to next navbar link; added Vitest spec. |
| [#1210](https://github.com/bpatrik/pigallery2/pull/1210) | Lightbox releases scroll lock when destroyed while open | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Upstream integration merge `91eef0cf`. Adapted to fork's Web Animations API lightbox. |
| [#1358](https://github.com/bpatrik/pigallery2/pull/1358) | Search matches names with double spaces | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | |
| [#1375](https://github.com/bpatrik/pigallery2/pull/1375) | Random links accept shortened query format and start from shown folder | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Frontend adapted to fork component style; added Vitest + `GalleryRouter.spec.ts` coverage. |
| [#1382](https://github.com/bpatrik/pigallery2/pull/1382) | Backslash escaping in search; CodeQL config; nginx API rate limit | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Other CodeQL fixes already in fork. |
| [#1270](https://github.com/bpatrik/pigallery2/pull/1270) | Fall back to full-file exifr read when chunked read fails near 64 KiB XMP | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Preserved fork's RAW preview extraction. |
| [#1409](https://github.com/bpatrik/pigallery2/pull/1409) | Close exifr file handle on parse error (empty/1-byte photos) | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | |
| [#1404](https://github.com/bpatrik/pigallery2/pull/1404) | Negated ranges, whole-day dates, decimal searches; `=`/`!=` in query builder | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Query builder adapted to fork component; added Vitest spec. |
| [#1385](https://github.com/bpatrik/pigallery2/pull/1385) *(partial)* | Uploads never create folders; "already exists" error hides disk path | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Adapted onto `SafePath` uploader; route-level folder-access check deferred until `#1205`. |
| [#1413](https://github.com/bpatrik/pigallery2/pull/1413) | Escape user input in failed-login logs; warn on untrusted reverse proxy; Fail2Ban guide | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Also fixed null sharing dereference on unknown share key; skipped `.xlf`-churning `trustProxy` text reword. |
| `cf82bd04` | Case-insensitive nginx login rate limit, TLS 1.2+, client IP forwarding, security headers | [#41](https://github.com/GitchalWoo/pigallery2.5/pull/41) | Kept `55m` buffered upload limit until `#1378` is ported. |
| [#1212](https://github.com/bpatrik/pigallery2/pull/1212) (`22088d3a`, `c363b088`) | Revalidate cookie sessions against DB with cached HMAC stamps; enforce `Server.sessionTimeout`; start sessions only in `AuthenticationMWs` (`OIDCMWs`, `refreshSession`) | [#42](https://github.com/GitchalWoo/pigallery2.5/pull/42) (merged at `27f28f16`) | Kept signed/CSRF cookies, SHA-256 projection keys, `RateLimiter`, `AUD2` OIDC binding; omitted `#1205` `DirectoryAccess` and `unlinkOidc`. Closes session-revocation finding in [Public-Exposure-Audit-2026-10-10.md](Public-Exposure-Audit-2026-10-10.md). |
| [#1400](https://github.com/bpatrik/pigallery2/pull/1400) (security changes) | Enforce role grants, target-account permissions and album list access on the server. Filter settings role choices for the signed-in user. | [#44](https://github.com/GitchalWoo/pigallery2.5/pull/44) (merged at `b141cd0d`) | Adapted `cc4e220e` as `680ea986`, `a5b99924` as `d39508eb`, and the fail-closed user-ID guard from `31fe743d` as `9f3483e5`. Album writes require Admin. Existing Developer-only read configurations retain that threshold. Album-delete issue #1173 is tracked separately. |
| [#1384](https://github.com/bpatrik/pigallery2/pull/1384), [#1369](https://github.com/bpatrik/pigallery2/pull/1369), [#1394](https://github.com/bpatrik/pigallery2/pull/1394), [#1395](https://github.com/bpatrik/pigallery2/pull/1395), [#1396](https://github.com/bpatrik/pigallery2/pull/1396), [#1397](https://github.com/bpatrik/pigallery2/pull/1397) | Lightbox Back-button close (`LightboxGrid`), scroll date label (`showScrollLabel`), and virtualized grid (`GridLayout`, `GridScroller`, `GridScrollWindow`, `ScrollRestorationService`) | [#45](https://github.com/GitchalWoo/pigallery2.5/pull/45) | Kept Zone.js, `TopLoadingBarComponent`, `LightboxGesturesDirective`, `cancelActiveRequest()`, `openingTimer` fallback, `0×0` NaN guard, Web Animations API lightbox, and Prism styles; bridged RxJS services in `GalleryGridComponent`; extended `LightboxGrid` for Timeline and removed `LightboxSource.ts` / `timeline-lightbox.source.ts`. Included `#1391` loop-restart next-button icon and proportional Timeline Scrubber (`feat/timeline-scrubber`). Verified with Mocha (1,048 SQLite+MariaDB), Vitest (362), Cypress (19 active), and 8086 test container manual checks. |

---

## Planned (Queued in Priority Order)

| Order | Upstream PR / Commits | Summary | Effort | Notes for This Fork |
| --- | --- | --- | --- | --- |
| 2 | [#1418](https://github.com/bpatrik/pigallery2/pull/1418) (`4b416523`, `0b72047c`) | Info panel map shows a styled pin even before folder map loads, and recenters when switching photos | S | Fork's info panel binds center only via `leafletOptions`, so the bug applies. Replace upstream Playwright tests with a Vitest spec. |
| 3 | [#1414](https://github.com/bpatrik/pigallery2/pull/1414) (`d80050bb`) | `Server.Log.file`: optional log file rotated at 10 MB for Fail2Ban on hosts without journald | S | Completes Fail2Ban support from `#1413`. Check `ConfigDiagnostics` and Docker data paths; file must stay inside configured data folder. |
| 4 | [#1378](https://github.com/bpatrik/pigallery2/pull/1378) (`4ebb11e5`, `b22d438a`, `6d52e24d`, `9c3e7e2b`) | Uploads stream to temp folder instead of RAM; `Upload.maxFileSizeMB` / `blockedExtensions`; uploader names rejected files & offers retry | M–L | Keep `SafePath` writes, `wx` exclusive creation, concurrency limit, 50 MiB default, and PR #41 `DirectoryNotFound` handling. Afterwards update nginx/NPM guides to `500m` + `proxy_request_buffering off` (`6d52e24d`). |
| 5 | [#1205](https://github.com/bpatrik/pigallery2/pull/1205) (`2615d2a5`, `4d5a77ba`, `39ce8072`, `0583c8c8`) | Folder sharing with password/expiry; per-user `allowDirectoryList` / `blockDirectoryList`; `DIRECTORY_NOT_FOUND`, `req.directoryAccess`, `authoriseDirectory` | L | Plan as its own step. Drop upstream SQLite LIKE escaping (fork already has its own). Unblocks the Deferred items below. |
| 6 | [#1198](https://github.com/bpatrik/pigallery2/pull/1198), [#1380](https://github.com/bpatrik/pigallery2/pull/1380) | Sort/group by directory; accent-insensitive SQLite search | M each | `#1380` is off by default (slower SQLite); `#1198` needs Timeline grouping check. |
| 7 | [#1371](https://github.com/bpatrik/pigallery2/pull/1371)–[#1381](https://github.com/bpatrik/pigallery2/pull/1381) *(selective, see commit decisions below)* | UX fixes found by upstream e2e tests | M | Cherry-pick individual commits, not whole PRs: deep-link redirect after login & "session ended" banner (`#1372`), album delete confirmation (`#1379`), zip named after folder (`#1381`). |

---

## Deferred

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
| [#1400](https://github.com/bpatrik/pigallery2/pull/1400) *(optional album-creation commits)* | Optional `Album.writeAccessMinRole` feature for normal users — skipped by user decision; security commits are listed under **Ported**. |
| [#1410](https://github.com/bpatrik/pigallery2/pull/1410) | Upstream modern theme — fork has its own Prism 2026 design system. |
| [#1401](https://github.com/bpatrik/pigallery2/pull/1401) | Upstream About page & "What's new" admin popup — upstream branding/release-notes specific. |
| `#1220`, `#1221`, `#1251`, `#1252`, `#1253`, `#1255`, `#1256`, `#1258`, `#1259`, `#1261`, `#1262`, `#1264`, `#1265`, `#1272`, `#1275`, `#1278`, `#1295`, `#1296`, `#1297`, `#1298`, `#1299`, `#1301`, `#1303` (stack changes) | Upstream Angular 20–22, zoneless, Express 5, `openid-client` 6, TypeORM 1, Node 26, Gulp, Playwright, and lint modernization phases — fork modernized independently on Node 24, `@angular/build` + Vitest + Cypress, native Node scripts in `scripts/`. |
| `#1166` (`8e5e99c9`) | Drop malformed GPS NaN — already present in fork (`PR #11`). |
| `#1389`, `#1398`, `#1403`, `#1411`, `#1415`, `#1419`, translation-only & release-checklist commits | Upstream release tooling, Playwright e2e media, docs screenshots/GIFs, and `.xlf` regeneration. |

## November 21 coverage audit

The range `dc456950..c36b1fdc` contains 641 commits. Its 205 first-parent entries consist of 109 numbered PR merges, one integration merge (`91eef0cf`, which brings in #1210), and 95 direct commits. Including nested merges gives 110 numbered PRs. A PR disposition covers its branch commits unless a more specific entry below applies. Merge commits follow their contents. For a merge `M`, use `git log --no-merges M^1..M` to recover its exact inventory.

### Deferred pending fork comparison

These candidates sit outside the nine ranked steps. Before promoting one, compare the upstream behavior and regression tests with the fork. For mixed PRs, retain the existing decisions on framework migrations, upstream test runners, and release files.

| Upstream | Behavior to compare | Related fork work |
| --- | --- | --- |
| #1170, `52ebed29` | Share links and other application URLs under a non-root `urlBase` | Check generated URLs as well as redirects. |
| `e007799f`, `f6b22cdd`, #1303 (`fe16aead`) | Non-RS256 providers, userinfo-only claims, OIDC links, user retention across schema changes, insecure-issuer warning | Preserve AUD2 account binding and in-place migrations. |
| `e25f3fda`, `a041087a`, `d12e0936` | Password-protected share logout, auth middleware follow-up, default share view options | Compare with #1205 and merged #1212. |
| `12bccc5a`, `eb9b96b4`, `dea51c73`, `0d262ff3` | SQL escaping, saved-search date ranges and missing search values | Check SQLite and MariaDB. |
| #1168, `de4c72a4`, `eebd645f`, `33b99240` | Folder exclusion globs, case-sensitive folder/file matching and setting descriptions | Check existing configurations. |
| #1200, `36caf087`, #1214 | Extension metadata filters, in-place refresh after metadata edits, mobile Enter key and form button types | Compare both search entry points. |
| `c98c2151`, #1274, `bdc57a25` | Upload filename handling and blocked types, accented filenames, job progress, search field validity, navbar accessibility and lightbox animation teardown | Compare with #1378 and #1210. |
| #1370, `207eef3f` | API error statuses, logout on authorization failure and error formatting | Preserve the fork’s 401 loop guard. |
| #1386, #1387, #1388 | Extension reload cleanup, kit publishing and backend-free enum exports | Review reload independently. Kit changes await a decision on the fork’s extension distribution. |
| #1390, #1391, #1393, #1416 | Installed app on phones, slideshow restart control, version link and inline blog layout | Check against Prism and gallery grouping. |
| `c214d5c5`, `a41d5577`, `68ca3a26`, `94e26454` | Grouped row heights, distant date groups, long toasts and unsupported-browser feedback | Compare grid changes with steps 6–7. |
| `c4f66156`, `d5fd716b`, `2cb691c4`, `8ba350db`, `9fe9eaaf`, `1d17b220`, `bcad49e0` | Version logging, slideshow defaults, reload control styling, navbar dismissal, mobile menu and slider layout, photo info links | Compare current Prism behavior before adopting upstream defaults or styles. |
| #1343 (`e60006ac`), #1410 (`8b5b6419`, `947f95d7`) | Breadcrumb Home URL, opening a partially visible photo, grid info bar positioning | Review these behavior changes separately from Playwright and the modern theme. |
| #1220, #1221, #1255, #1259, #1262, #1265, #1296, #1301 (behavioral hunks) | Changes mixed into tooling PRs include blog rendering, stable list keys, job defaults, notifications, share navigation, diagnostics and search input checks | Compare runtime changes when reviewing the affected feature. The stack migrations remain skipped. |
| `a82bec8b`, `3a43889a`, `c7564ca8`, `1084031d`, `10165e9c`, `8d8a22c2` | DB test races, cache cleanup, deterministic covers, collation, teardown, MySQL reset and benchmark runner | Compare with the fork’s database test isolation and benchmark scripts. |
| #1348, #1349, #1351, #1352, #1353, #1367 | Backend regression scenarios for API errors, users, sharing permissions, jobs, settings and gallery changes | Reuse applicable cases with the feature port. Preserve the fork’s upload-limit coverage. |

### Commit decisions within selective PRs

| PR | Planned or previously decided | Remaining commits |
| --- | --- | --- |
| #1371 | No individually queued commit | **Deferred** for fork comparison: map/GPX `053ea9f7`, zip query parameters `7b5b6e51`, flattening `91e374dc`, grouping `97dfe73a`, notifications `7eafcd1e`, duplicates `be5da765` and `f01bf7e5`, slideshow `9ae9151b`, face names `85edb8da`. **Skipped** upstream e2e setup `b5f96bfd`. |
| #1372 | **Planned** deep-link return `14122e83` and session-ended banner `7de24347` | **Deferred** password field reset `93cfd4b5`. **Skipped** test relabel `f31ddcc4` and lockfile `451bd3a8`. |
| #1373 | No individually queued commit | **Deferred** loading and empty states, folder errors and unknown routes (`990af75e`, `7dab232d`, `3aec0c9e`, `182f0912`). Revisit folder errors with #1205. |
| #1374 | **Deferred** sharing permissions, expired links and guest navigation until #1205 (`b41608d6`, `a369c245`, `78e24893`, `ec95c780`) | **Deferred** empty random-link and frame results (`c0bc7229`, `d90170bb`) for separate comparison. **Skipped** translation refresh `fa70a527`. |
| #1376 | No individually queued commit | **Deferred** history/scroll and fade behavior (`aa1a5fea`, `15eacc82`, `2379cd7f`, `74d8ce3c`) for comparison during #1384. Also compare keyboard and touch behavior (`e4476463`, `420bdbe4`). |
| #1379 | **Planned** album deletion confirmation `23e9b9b2` | **Deferred** self-demotion guard `527c8abc`, admin-page redirect `09baecd1` and settings limits `6c74f3e1`. Review the guard alongside #1400. |
| #1381 | **Planned** folder zip naming `13b54a9b` | **Deferred** deleted-file download feedback `01790a52`. |
| #1380 | **Planned** accent folding, search performance and autocomplete behavior (`e0d265c6`, `38fc861f`, `74473bc5`, `3a8428de`, `3f7f68ff`) | **Deferred** geocoding error handling `7177c0e1` for comparison. **Skipped** upstream config documentation convention `e8dd72cb`. |
| #1385 | **Ported** upload fixes from `db893d56` with its route check **Deferred** until #1205 | **Skipped** upstream old-browser e2e fixture adjustment `b4dc9f46`. |
| #1394 | **Planned** grid rendering, scrolling and related config changes (`2a83005f`, `1ade9d14`, `bf6b8bc9`) | **Skipped** upstream e2e adjustments `003790d4`, `46d443f8` and sponsor markup `d1fea9a6`. |
| #1400 | **Ported on the port branch**: role and album-read checks (`cc4e220e`, `a5b99924`), including the fail-closed guard from `31fe743d` | **Skipped** optional album creation/write roles (`1191b11a`, `f08aec3d`, `6952395f`, `676a2a2d` and corresponding hunks in later commits). |

### Additional obsolete or skipped changes

| Upstream | Reason |
| --- | --- |
| `e47258fa` | Path containment follows the fork’s SafePath policy, as for #1300. |
| #1185, #1276, #1341, `477f4d96`, `954cd607`, `241763d2`, `7ae98058`, `44c47a58`, `d7c74170`, `c36b1fdc` | Upstream directory listings, sponsorship, docs formatting, copy and README maintenance. |
| #1317, #1339, #1340, #1343 (test changes), #1347, #1350, #1354, #1355, #1356, #1357, #1359, #1360, #1361, #1362, #1363, #1364, #1365, #1366 | Upstream test tooling, fixtures, expected failures and journey suites. Use relevant scenarios in the fork’s required Vitest, Mocha and Cypress coverage. |
| #1342, `7a6cf819`, `6b875239`, `a412a1b1`, `ea008b66`, `d29b6e9a`, `539ed044`, `dd648c65`, `396a6eb4`, `dcdfa14b`, `d1f9aac3`, `18b7c907` | Fork maintains its own database driver versions, dependency tree, typings, build config and lockfiles. |
| `1ce8b347`, `97c1946b`, `52fa08aa`, `b68d9106`, `9b2cb664` | Upstream CI stages, test credentials and reporting conventions. |
| `c622ca96`, `2d3bcb2d`, `ce8d0c93`, `9234ba24`, `d62a4299`, `e92fe158`, `fc0ddfe8`, `b8283858`, `8a242f13`, `20d77a48`, `5619b2a4` | Upstream contributor and agent instructions. This fork maintains its own guide. |
| #1406, #1407, `3efcea85`, `e062a0d4`, `8db90ffa`, `1cf4a425`, `e2abb5e3`, `f7c5a394` | Upstream releases, checklists, screenshot recording and GPS edits to upstream demo photos. |
| `573d26d9`, `05b85d27`, `c554295a`, `69c4e894`, `342c3990`, `b54f951f`, `135f6930`, `786428fd`, `abca752c`, `94b9eee2`, `67706f08`, `9f79f90f`, `93e44868`, `4967cedd`, `09d710b8`, `dad6e63a`, `667795bf` | Translation-only updates for upstream strings. |
