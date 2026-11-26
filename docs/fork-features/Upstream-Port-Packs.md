# Upstream Port Packs

Execution plan for porting every remaining upstream change from [bpatrik/pigallery2](https://github.com/bpatrik/pigallery2) up to watermark `c36b1fdc` (2026-11-21), extended by later surveys up to `3b61ddc9` (2026-11-26; the current watermark is in the ledger). The plan is meant for an agent working **one pack at a time, one PR per pack**.

- How to port (workflow, impact report, conflict rules, tests, PR process): [Upstream-Porting.md](Upstream-Porting.md).
- Status of every upstream PR and commit: [Upstream-Ledger.md](Upstream-Ledger.md).
- This file only says **what goes into which PR, in which order, and which decisions are already made**.

---

## 1. How the work is split

The workflow for every pack — presence check, impact report and approval, porting, tests, ledger, PR — is in [Upstream-Porting.md](Upstream-Porting.md). This section only covers how the plan is laid out.

1. **One pack = one branch = one PR**, named `port/upstream-p<NN>-<topic>`. A pack may be split into smaller PRs (rule 5). Packs are merged together only by a user decision recorded in section 2 (P07 went into P08).
2. **Packs run in the numbered order.** Start a pack only after the packs it depends on (section 3) are merged to `master`.
3. **Order follows upstream chronology where packs share files.** Upstream merged #1205 (directory access) before #1212, #1372, #1380 and #1383, and merged #1198 before its virtual grid. The fork already ported some later changes without those earlier ones (PR #42, PR #45). Porting the remaining base changes first, and their followers after them, keeps each conflict in one PR.
4. **Security-sensitive work is isolated.** Uploads (P02), directory access (P03), sharing (P04), OIDC (P05) and session handling (P06) each have their own pack, so a reviewer can read them with the fork's hardening rules in mind.
5. **Split a pack when it grows too large.** If a pack exceeds about 60 changed source files (excluding `.xlf`) or mixes backend and UI review, split it into `p<NN>a`/`p<NN>b` along the line given in the pack. The first part must leave `master` working and must fail closed.
6. **Only P03 and P04 may change the database schema.** P03a added the version 45 `DatabaseMigrations` step. P04 may add one additive step for `SharingEntity.preventDownload` (#1392), tested like P03a on populated SQLite and MariaDB databases. Any other pack that seems to need a schema change or a `DataStructureVersion` bump stops and asks the user.
7. **Pack tables list the expected scope and fork-specific notes.** A "Notes" entry is a requirement for that commit; a "verify" note means the commit is likely already in the fork.

---

## 2. Decisions already made

| Topic | Decision | Reason |
| --- | --- | --- |
| One big PR | **No.** 15 packs, one PR each (P07 merged into P08, see below). | More than 70 conflicting files and a schema migration in one PR cannot be reviewed or bisected. |
| P07 + P08 | **One pack, P08** (branch `port/upstream-p08-search`). | User decision before P08: both rework the LIKE conditions of `SearchManager`; one branch resolves them once and tests the final code on SQLite and MariaDB. The automated tests are the gate, not the diff size. |
| #1380 accent-insensitive SQLite search | **Port as upstream**, default off (P08). No extra folding of `ł`/`ø`/`ß`. | Keeps SQLite results identical to MariaDB `utf8mb4_general_ci`, which does not fold those letters either. Document that `ł` → `l` does not match. |
| #1198 sort/group by directory | **Port** (P09), after the search packs. | Wanted feature. It must be re-implemented inside the fork's `GridLayout`/`GridScroller` from PR #45, not cherry-picked into the old grid. |
| #1378 upload move into the gallery | **Never `rename()` over a target.** | Upstream `fs.promises.rename()` silently replaces an existing file and breaks the fork's `wx` no-overwrite guarantee. Use `fs.promises.link()` + `unlink()` (fallback `copyFile(..., COPYFILE_EXCL)` + `unlink()` on `EXDEV`/`EPERM`). The target path comes from `SafePath.resolveForWrite`. |
| #1414 log file location | **Contained.** `Server.Log.file` resolves inside the configured data folder via `SafePath`; paths outside it are rejected and logged. | Upstream `ProjectPath.getAbsolutePath(file)` lets an admin setting create files anywhere the process can write. |
| #1205 schema | **`DatabaseMigrations` step**, no drop-and-rebuild. | New nullable columns: `UserEntity.allowDirectoryList` / `blockDirectoryList`, `SharingEntity.directoryQuery`. `SharingEntity.searchQuery` becomes nullable, which needs a table rebuild on SQLite. Test the migration on populated SQLite and MariaDB databases. |
| #1205 SQLite LIKE escaping (in `0583c8c8`) | **Skip that hunk.** | The fork has its own escaping (`ESCAPE '\\'`). Keep the user-cache fix from the same commit. |
| #1205 split | **P03a** backend, migration and tests (PR [#48](https://github.com/GitchalWoo/pigallery2.5/pull/48)); **P03b** UI (PR [#49](https://github.com/GitchalWoo/pigallery2.5/pull/49)). | P03 changed 59 `src/` files upstream and mixed backend and UI review. |
| `39ce8072` media lists | **Port as upstream.** A `directory:` search in `Users.allowQuery` / `blockQuery` only filters media; folders are hidden by the directory lists. | User decision during P03a. `ConfigDiagnostics` warns at startup when the global media lists contain a directory search; `user-rights.md` explains the upgrade. |
| `e25f3fda` `NOT_AUTHENTICATED_SHARING` | **Only for requests that carry a sharing key.** Other unauthenticated requests keep `NOT_AUTHENTICATED`. | The fork client clears the user on `NOT_AUTHENTICATED`; upstream answers every unauthenticated request with the sharing code. |
| #1370 `c76f1daf` "Log out on NOT_AUTHORISED for every request" | **Adapt.** | Keep the fork guard: log out only when `isAuthenticated()` is true and the URL is not `/user/me`, `/login` or `/logout`. Otherwise the 401 loop returns. |
| `#1372` deep link and session banner | **Moved from "small fixes" to P06**, after #1205. | They touch `navigation.service.ts` and `authentication.service.ts`, which #1205 also changes. Upstream applied them after #1205. |
| `12bccc5a` mysql2 upgrade | **Skip the dependency part**, compare the escaping part. | The fork manages its own database driver versions. |
| `f6b22cdd` "keep users on scheme updates" | **Skip that hunk**, compare the OIDC strict mode. | `DatabaseMigrations` already keeps users. Strict mode must not weaken `AUD2`. |
| #1387 publish extension kit, #1388 enum move for the kit | **Skip.** | The fork does not publish an extension kit. The #1388 enum move churns 35 files for no runtime gain. Reopen if the fork starts publishing the kit. |
| Stack PRs (#1220, #1221, #1255, #1259, #1262, #1265, #1296, #1301) | **Sweep runtime hunks once** (P15); framework migration stays skipped. | Upstream mixed a few bug fixes into the framework PRs. |
| Template accessibility (PR [#55](https://github.com/GitchalWoo/pigallery2.5/pull/55), upstream `23eb43d7`) | **Ported templates must pass the accessibility lint errors.** | Since PR #55 the six `templateAccessibility` rules are errors. Upstream templates written before `23eb43d7` (e.g. clickable `div`s in P09–P12) are adapted to buttons, or to a role, `tabindex` and Enter/Space handlers, while porting. |
| Upstream Playwright, e2e fixtures, translations, release tooling | **Skip** (unchanged). | See the ledger. Behavior is covered by Vitest, Mocha and Cypress instead. |

---

## 3. Pack overview and dependencies

| Pack | Topic | Effort | Depends on | Security review |
| --- | --- | --- | --- | --- |
| P01 | Small independent fixes | S | — | Log file containment |
| P02 | Streaming uploads | M–L | — (independent of P01) | **Yes** |
| P03 | Directory access & folder sharing core (#1205) | L | P01 | **Yes** |
| P04 | Sharing follow-ups (#1374, #1392) | M | P03 | **Yes** |
| P05 | OIDC & `urlBase` follow-ups | M | P03 | **Yes** |
| P06 | Session UX & API error statuses | M | P03, P05 | **Yes** |
| P07 | Merged into P08 | — | — | — |
| P08 | Search fixes & accent-insensitive search (#1380, #1383, #1214) | M–L | P03, P06 | Escaping, directory lists |
| P09 | Sort/group by directory & navigator | M | P08 | — |
| P10 | Grid & lightbox parity | M | P09 | — |
| P11 | Loading, empty & error states | M | P03, P06 | — |
| P12 | Prism shell, admin & PWA polish | M | P11 | — |
| P13 | Indexing, extensions & config | M | — | Extension reload |
| P14 | Test infrastructure & regression scenarios | M | P03–P08 | — |
| P15 | Stack-PR runtime-hunk sweep | S–M | all others | — |

P02 and P13 do not depend on other packs and can be done whenever convenient.

---

## 4. Packs

For PRs listed without hashes, enumerate commits with step 3 of [Upstream-Porting.md](Upstream-Porting.md):

```bash
m=$(git log --merges --format=%H --grep="Merge pull request #<PR> " dc456950..upstream/master | head -1)
git log --no-merges --reverse --format='%h %s' $(git merge-base $m^1 $m^2)..$m^2
```

### P01 — Small independent fixes (S)

Branch `port/upstream-p01-small-fixes`. PR title topic: `small independent fixes (#1418, #1414, #1379, #1381, #1371)`.

| Commit | Change | Notes |
| --- | --- | --- |
| `4b416523` (#1418) | Styled pin on the info panel map before the folder map loads | No conflicts in a dry run. The CSS moves into global `styles.css`; it must not break Prism. |
| `0b72047c` (#1418) | Info panel map recenters when switching photos | Conflicts in `info-panel.lightbox.gallery.component.{html,ts}`. Vitest spec for pin and recentering. |
| `d80050bb` (#1414) | `Server.Log.file`, rotated at 10 MB | Conflicts in `Logger.ts`, `PrivateConfig.ts`, config snapshot. Apply the containment decision (section 2): a rejected path is logged, file logging stays off, the server keeps running. Add a `ConfigDiagnostics` warning for a rejected or unwritable path. Update the Fail2Ban guide. Port `Logger.spec.ts` and add tests for rotation (`.1` file) and rejected traversal/outside paths. |
| `23e9b9b2` (#1379) | Confirm before deleting an album | Conflicts in `album.component.{html,ts}`. Vitest spec. |
| `13b54a9b` (#1381) | Folder zip named after the folder (`res.attachment`) | Not in fork yet. Conflicts only in tests; port the Mocha tests. |
| `01790a52` (#1381) | Toast when downloading a deleted file from the lightbox | Vitest spec. |
| `053ea9f7` (#1371) | Map marker at latitude 0; short GPX track stats | Vitest spec. |
| `7b5b6e51` (#1371) | Join query params of the zip download link | Vitest spec. |
| `85edb8da` (#1371) | Wrap long face names on phones | CSS only. Prism styling wins. |

Ledger selective rows to update: #1371, #1379, #1381.

Browser checks:
- the info panel map shows a pin and recenters on the next photo;
- album delete asks for confirmation;
- a folder zip downloads with the folder's name;
- `Server.Log.file` creates and rotates the file inside the data folder.

The 8086 container check is not needed: no auth, session or upload changes.

### P02 — Streaming uploads (M–L, security)

Branch `port/upstream-p02-uploads`. Commits in this order:

| Commit | Change | Notes |
| --- | --- | --- |
| `c98c2151` | Harden upload filenames; block `pg2conf` and `svg` uploads | Upstream base for #1378's `blockedExtensions`. Keep `SafePath`. |
| `1e65ca19` (#1274) | Keep accented letters of uploaded file names | Keep the fork's filename sanitizing. |
| `4ebb11e5` (#1378) | Stream to `TempFolder/upload`; `Upload.maxFileSizeMB` | Default `maxFileSizeMB` = **50**. Keep `MAX_CONCURRENT_UPLOADS = 5` and the 10-file limit. Apply the move-without-overwrite decision. Remove stale temp files at startup. |
| `b22d438a` (#1378) | Uploader names rejected files, explains unwritable folders, offers retry | Keep PR #41 `DirectoryNotFound` handling. The fork has no upstream toast system: apply it to the uploader's progress cards; Vitest for `uploader.service` and the uploader component. |
| `6d52e24d` (#1378) | nginx examples allow 500 MB + `proxy_request_buffering off` | **Not applied** (decided during P02): keep `55m` with request buffering on, so slow clients cannot hold the 5 upload slots; only the comments in the docker-compose and NPM guides change. |
| `9c3e7e2b` (#1378) | Remove temp files before answering | Also on error paths. |

Required tests (Mocha):
- an existing target file is never replaced;
- concurrent uploads of the same name: exactly one succeeds;
- oversized file rejected while the others in the request succeed;
- no temp file is left after success, rejection or a client abort;
- traversal names stay rejected.

Container check: upload through the 8086 instance.

### P03 — Directory access & folder sharing core (L, security, schema)

Split into **P03a** (backend, migration, tests; branch `port/upstream-p03a-directory-access`, PR [#48](https://github.com/GitchalWoo/pigallery2.5/pull/48)) and **P03b** (branch `port/upstream-p03b-directory-access-ui`, PR [#49](https://github.com/GitchalWoo/pigallery2.5/pull/49)).

**P03b scope** (what P03a left out): the frontend hunks of `2615d2a5` (share dialog with folder sharing and "Include subfolders", users settings lists, `ContentLoaderService` folder-not-found navigation, navigator breadcrumb parents, `ShareService.getDefaultRoute` / `getPublicSharing` / `dropSharing`, logout of a sharing without password), of `39ce8072` (sharing lists, share popup copy button, `directory-search-list` editor, settings entry, `TextSearchMatchingTypes`), of `0583c8c8` (gallery cache dropped on user change, Cypress `share.cy.ts` scenarios), and the `ShareService` default-view hunk of `d12e0936`. Prism styling, fork component style, Vitest for each adapted behavior.

| Commit | Change | Notes |
| --- | --- | --- |
| `e25f3fda`, `a041087a`, `d12e0936` | Password-protected share logout loop, auth follow-up, default share view options | Upstream base of #1205 (Oct 18). Fork already has default view options (`a6f7f6bd`); port the fixes only. |
| `2615d2a5` (#1205) | `DirectoryAccess`, allow/block lists, folder sharing, `DIRECTORY_NOT_FOUND`, `req.directoryAccess`, `authoriseDirectory` | Core. Keep `SafePath`, signed/CSRF cookies, SHA-256 projection keys. |
| `4d5a77ba` (#1205) | ignore files | `.gitignore` only; merge with the fork's entries. |
| `39ce8072` (#1205) | Sharing lists, 404 for media, list editor fixes | |
| `0583c8c8` (#1205) | Sharing tests, user cache fix | Skip the LIKE-escaping hunk. Convert the e2e tests to Mocha and Cypress (`test/cypress/e2e/share.cy.ts`). |
| #1212 omitted hunks of `22088d3a`, `c363b088` | `DirectoryAccess` parts of session revocation left out by PR #42 | Re-read both commits and port only the `DirectoryAccess` / `SessionContext` hunks. |
| `32d5d33f` | `GalleryMWs.listDirectory` stops calling `AuthenticationMWs` | Was Deferred. |
| `db893d56` route check (#1385) | `authoriseDirectory` on upload routes | Was Deferred. |
| #1367 | Test that a sharing guest sees nothing outside the shared folder | Port as Mocha. This is the main regression test of the pack. |

Migration: write the next `DatabaseMigrations` step and bump `DataStructureVersion` once. Test an upgrade from current `master` on SQLite and MariaDB with users and shares present.

Required tests:
- block list beats allow list;
- search, random, zip, thumbnail and projected-cache paths all honor directory access;
- shared folder with password and expiry;
- unknown folder returns `DIRECTORY_NOT_FOUND` without leaking existence.

### P04 — Sharing follow-ups (M, security)

Branch `port/upstream-p04-sharing`.

| Commit | Change | Notes |
| --- | --- | --- |
| `b41608d6` (#1374) | Admin can update another user's sharing | Was Deferred. Check the fork's role rules from PR #44. |
| `c0bc7229` (#1374) | Random link matching nothing → plain-text 404 | |
| `a369c245` (#1374) | One page for invalid or expired sharing links | Was Deferred. |
| `78e24893` (#1374) | Invalid-link page when a sharing ends while open | Touches `error.interceptor.ts`; keep the 401 guard. |
| `ec95c780` (#1374) | Keep the sharing link in a guest's address bar | |
| `d90170bb` (#1374) | Full-screen message for a photo frame that matches nothing | |
| `251d002f` (#1392) | "Prevent downloading" option on shares | Server-side enforcement on zip, original-file and download routes is required, not only hidden buttons. |
| #1351 | Backend sharing tests | Reuse the applicable scenarios. |

`fa70a527` stays skipped (translations).

### P05 — OIDC & urlBase follow-ups (M, security)

Branch `port/upstream-p05-oidc-urlbase`.

| Commit | Change | Notes |
| --- | --- | --- |
| #1170 | Share links honor a non-root `urlBase` | |
| `52ebed29` | `Config.Server` URL helpers for all app links | Compare with the fork's OIDC `urlBase` redirect; keep one helper. |
| `e007799f` | OIDC with non-RS256 IdPs, userinfo-only claims | Extend the `MockOIDCServer` tests. |
| `f6b22cdd` | OIDC strict security mode | Skip the "keep users on scheme updates" hunk. Strict mode must stay at least as strict as `AUD2`. |
| `fe16aead` (#1303) | Settings warning for an `http://` issuer | Rest of #1303 stays skipped. |
| #1349 | Backend tests: users, no login, fresh install, `urlBase` | Reuse the scenarios that fit. Keep `admin-bootstrap.txt` behavior. |

Verify interactively with the Dex container (see AGENTS.md).

### P06 — Session UX & API error statuses (M, security)

Branch `port/upstream-p06-session-ux`.

| Commit | Change | Notes |
| --- | --- | --- |
| `207eef3f` | Error message formatting | |
| `6abd72d6`, `ba061baf` (#1370) | Every API error carries its HTTP status | Update fork Mocha expectations. Check CSRF and `RateLimiter` responses keep their codes. |
| `c76f1daf` (#1370) | Log out on NOT_AUTHORISED | **Adapt** (see decisions). Add Vitest cases for the 401 loop. |
| `14122e83` (#1372) | Return to the deep link after login | Validate the return URL as same-origin app path (no open redirect). |
| `7de24347` (#1372) | "Session ended" toast | |
| `93cfd4b5` (#1372) | Clear the password after a wrong login | |
| `527c8abc` (#1379) | Admin cannot lower their own role | Compare with PR #44's checks first; may already be covered. |
| `09baecd1` (#1379) | Normal user sent from admin page to the gallery with a warning | |
| `6c74f3e1` (#1379) | Show setting limits; refuse out-of-range values | |
| #1348 | Backend API error tests | Reuse scenarios. |

`4cfcebfc`, `8c624135` (#1370), `f31ddcc4`, `451bd3a8` (#1372) stay skipped (e2e markers, AGENTS.md, lockfile).

#1423 (`8b5f2bae`, OIDC login errors on the login page and no server paths in error messages) joined P06: with real HTTP statuses a failed OIDC callback would otherwise show a raw JSON 401/403 in the browser.

### P07 — merged into P08

P07 (search correctness) was merged into P08 by a user decision; its commits are listed there.

### P08 — Search fixes & accent-insensitive search (M–L)

Branch `port/upstream-p08-search`. Depends on P06: the HTTP status of `LocationLookUp_ERROR` comes from its error mapping.

| Commit | Change | Notes |
| --- | --- | --- |
| `12bccc5a`, `eb9b96b4` | SQL escaping fixes | Already in the fork (`ESCAPE '\\'` only on SQLite, `mysql2`). Record only. |
| `0d262ff3` | Report an invalid search query instead of crashing on a missing value | The throw is in the fork; port the album warning and the test. |
| `dea51c73` | Saved-search albums by date range | Vitest for query builder and albums. |
| `a9066201` (#1274) | Search fields are valid when they have no errors | |
| #1214 (`777914e7`, `4bce12ab`) | Phone Enter key launches search, also in the search dialog | Vitest + Cypress instead of Playwright. |
| #1214 (`dc3aa0a0`) | Every button gets a `type` | Re-done on fork templates with the `button-has-type` lint rule, not cherry-picked. |
| `e0d265c6` (#1380) | `Database.sqlite.accentInsensitiveSearch` (default off) | Keep `ESCAPE '\\'` handling. |
| `38fc861f` (#1380) | Text cache; skip empty columns | |
| `74473bc5` (#1380) | Bold typed text in autocomplete across accents | Vitest (`AutoCompleteRenderItem`). |
| `3a8428de` (#1380) | Performance warning in settings and docs | |
| `3f7f68ff` (#1380) | `fold()` once per keyword; Greek final sigma | |
| `7177c0e1` (#1380) | `LocationLookUp_ERROR` on geocoding failure | Brings `SearchErrors.spec` deferred from P06. |
| `8bb42c88`, `f70ed4bc` (#1383) | Accent-aware directory allow/block lists | Security: MariaDB already ignores accents in SQL, so the JS check must too. |

Document the `ł`/`ø`/`ß` limitation in `docs/user-guide/configuration.md`. `e8dd72cb` stays skipped.

### P09 — Sort/group by directory & navigator (M)

Branch `port/upstream-p09-directory-sort`. **Ported** in PR [#56](https://github.com/GitchalWoo/pigallery2.5/pull/56). The PR #45 grid needed no layout change: its segments carry the whole `MediaGroup`, so only the header and scroll-label cases and the sorting logic were added.

| Commit | Change | Notes |
| --- | --- | --- |
| `8f06e072`, `68f0f0fb`, `19f02757` (#1198) | Sort/group by directory path, search only, tree order | Re-implement grouping in `GridLayout`/`GridScroller`. Check the Timeline still groups by date. Skip translation commit `75299af5`. |
| `97dfe73a` (#1371) | Group by name, accent-aware | Uses P08 helpers. |
| `91e374dc` (#1371) | Flatten only the folder and its subfolders | |
| #1343 (`e60006ac`) | Breadcrumb Home links to `/gallery` | |
| `9fe9eaaf` | Sort/group menu stays on screen on phones | Check against Prism. Since PR #55 the menu items are `<button>`s (with `span` labels), not `div`s: adapt the upstream CSS selectors to that markup and keep the keyboard Cypress spec (`accessibility.cy.ts`) passing. |

### P10 — Grid & lightbox parity (M)

Branch `port/upstream-p10-grid-lightbox`. Step 0 matters most here: PR #45 hand-ported much of the virtual grid. Several of these are probably already in.

| Commit | Change | Notes |
| --- | --- | --- |
| `aa1a5fea`, `e4476463`, `420bdbe4`, `15eacc82`, `2379cd7f`, `74d8ce3c` (#1376) | Back/forward scroll restore, keyboard open, face tap, fade only new photos | Likely partly in PR #45. Keep `LightboxGesturesDirective` (no Hammer). |
| `2a83005f`, `1ade9d14` (#1394) | Full-height grid, touch scroll handle, render lines that scroll in | Ledger marks them Planned under #1394. |
| `c214d5c5`, `a41d5577` | Grouped rows with equal heights; distant date groups do not share a line | |
| `8b5b6419`, `947f95d7` (#1410) | Open a partially visible photo; info bar anchored to photo bottom | Behavior only, not the modern theme. |
| #1416 | Day group with inline blog gets its own line | |
| #1391 | Smaller restart icon, hidden for a single photo | Ledger says PR #45 included the loop icon; verify. `9ae9151b` likewise. |
| `bdc57a25` | Stop lightbox animations on destroy | Compare with the fork's #1210 adaptation (Web Animations API). |
| `1d17b220`, `2cb691c4` | Video control icons vs sliders on phones; reload button style | Check against Prism. |

### P11 — Loading, empty & error states (M)

Branch `port/upstream-p11-states`.

| Commit | Change | Notes |
| --- | --- | --- |
| `990af75e`, `7dab232d`, `3aec0c9e`, `182f0912` (#1373) | Spinners, empty states, folder load errors, "Page not found" | Restyle to Prism. `182f0912` touches `PublicRouter`/`ErrorRouter`; run `PublicRouter` tests. Folder errors use `DIRECTORY_NOT_FOUND` from P03. |
| `68ca3a26` | Long toasts scroll inside their card | |
| `7eafcd1e` (#1371) | Notification badge appears once notifications arrive | |
| `be5da765`, `f01bf7e5` (#1371) | Duplicates page loading state; translated summary | |
| `94e26454` | Old browsers told they are unsupported | Verify; may already be in the fork. |
| `222d67b6` (#1421) | Empty folder that accepts uploads offers an Upload button; `*.pg2conf` files no longer count as content | Builds on the #1373 empty state above. Reviewed in P02 and moved here. Vitest spec. |

### P12 — Prism shell, admin & PWA polish (M)

Branch `port/upstream-p12-shell-polish`. Fork design wins every styling conflict.

| Commit | Change | Notes |
| --- | --- | --- |
| `8ba350db` | Close navbar menu on outside click | |
| `36fc6635` (#1274) | Remove unused navbar collapse hidden from assistive tech | |
| `bcad49e0` | Underline photo info links on hover | |
| `d5fd716b` | Loop lightbox slideshow by default | Verify; may already be in the fork. |
| `c4f66156` | Log client version/build/commit to console | Compare with [Build-Version.md](Build-Version.md); the gulp part does not apply. |
| `9b6911b1`, `5c161414` (#1274) | Job counted finished when gone; job progress on settings cards | |
| #1390 | Installed app (PWA) on phones | Manifest/meta behavior only; drop `.xlf` churn. |
| #1393 | Clickable git commit in admin version popover | |
| #1352 | Backend admin and job tests | Reuse scenarios. |
| #1430 (`64d7d6b5`) | Login forms use the `username` / `current-password` autocomplete tokens | Also fix the fork-only Prism login (`themes/prism/login/prism-login.component.html`). Assert the tokens in Cypress (`login.cy.ts`, `share.cy.ts`) instead of Playwright. Skip release-note commit `f6f41186`. |

### P13 — Indexing, extensions & config (M)

Branch `port/upstream-p13-indexing-extensions`. Independent; can run any time.

| Commit | Change | Notes |
| --- | --- | --- |
| #1168, `de4c72a4`, `33b99240`, `eebd645f` | Glob wildcards in `excludeFolderList`; case-sensitive matching; clearer names | Existing configurations must keep working; add a `DiskManagerWorker` test with an old-style entry. |
| #1200, `36caf087` | `contains` / `!contains` in extension media-button `metadataFilter` | |
| #1386 | Extension reload runs changed code and drops old routes | Check that dropped routes really stop serving. |
| `bf6b8bc9` (#1394) | Remove `enableOnScrollRendering` | Fork still has the setting (`ClientConfig.ts`). Remove only if the PR #45 grid ignores it; keep old configs loading. |
| #1428 (`c3e257e7`) | Warn about unreadable videos and photos without a size while indexing; log skipped files with the `DiskManager` tag | The fork lists folders with `Dirent` types and checks symbolic links with `SafePath`; compare the stat-skip hunk instead of copying it. Upstream drops the admin notification for photo loading errors (log only): decide in the impact report. Port the `DiskManagerWorker` and `MetaDataLoader` Mocha tests. |

### P14 — Test infrastructure & regression scenarios (M)

Branch `port/upstream-p14-tests`.

| Commit | Change | Notes |
| --- | --- | --- |
| `a82bec8b`, `3a43889a`, `1084031d`, `10165e9c` | DB test races, `clearDB`, teardown, faster MySQL reset | Compare with `test/root-hooks.cjs` and `DBTestHelper`; keep fork isolation. |
| `c7564ca8` | Deterministic album covers; lazy column collation | **Runtime change** in `CoverManager` and entities. Test on MariaDB; collation must match existing columns. |
| `8d8a22c2` | Benchmark runner fix | |
| #1353 and leftovers of #1348, #1349, #1351, #1352 | Backend regression scenarios not already used in P02–P12 | Keep the fork's upload-limit coverage. |

### P15 — Stack-PR runtime-hunk sweep (S–M)

Branch `port/upstream-p15-stack-sweep`. Last pack, after all the others.

For #1220, #1221, #1255, #1259, #1262, #1265, #1296 and #1301, diff `src/` per PR and ignore framework, tooling, signal and control-flow migration. Port only real runtime fixes: blog rendering, stable list keys, job defaults, notifications, share navigation, diagnostics, search input checks. Record each PR's outcome in the ledger as "behavioral hunks ported: …" or "nothing applicable". Time-box: if a hunk needs framework changes to apply, skip it with that reason.

---

## 5. Finishing

After P15:
- The ledger's **Planned**, **Deferred** and **Deferred pending fork comparison** tables are empty or only contain items the user deferred on purpose.
- `node scripts/upstream-status.mjs --fetch --check` passes.
- New upstream commits after `c36b1fdc` go into a new pack list at the end of this file.
