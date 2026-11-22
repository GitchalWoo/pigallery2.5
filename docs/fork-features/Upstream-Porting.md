# Upstream Porting Rules & Workflow

Evergreen guide for porting changes from upstream [bpatrik/pigallery2](https://github.com/bpatrik/pigallery2) (`upstream` remote) into this fork (`GitchalWoo/pigallery2.5`, `origin` remote). Read [AGENTS.md](../../AGENTS.md) first for general project setup and test environment details.

- **Commit & PR tracker:** [Upstream-Ledger.md](Upstream-Ledger.md) tracks every upstream PR/commit since the common ancestor (`dc456950`) as **Ported**, **Planned**, **Deferred**, or **Obsolete / Skipped**.
- **Work queue:** [Upstream-Port-Packs.md](Upstream-Port-Packs.md) groups all remaining upstream changes into ordered packs (one PR each) with pre-made decisions.
- **Worked examples:** [PR #41](https://github.com/GitchalWoo/pigallery2.5/pull/41) (Tier 1 security & correctness fixes), [PR #42](https://github.com/GitchalWoo/pigallery2.5/pull/42) (`#1212` session revocation).

## Repository Facts & Fork vs. Upstream Rules

- `origin` = `GitchalWoo/pigallery2.5` (target; open PRs against `origin`'s `master`).
- `upstream` = `bpatrik/pigallery2` (source only; **never push** there).
- Common ancestor: `dc456950` (2026-08-25). A whole-branch merge conflicts in ~260 files — always port **PR by PR** on dedicated branches.
- Both repositories modernized independently (Angular 22, zoneless, Express 5, `openid-client` 6). When resolving conflicts, **preserve the fork's hardening**:

| Area | Fork (`origin`) | Upstream (`upstream`) | Conflict Rule |
| --- | --- | --- | --- |
| Path safety | `SafePath.resolve` / `resolveExisting` / `resolveForWrite`, `ExtensionPath` | `ProjectPath.resolveInImageFolder` | Keep `SafePath` / `ExtensionPath`. |
| Request params | `req.params[...]` + `normalizePathParam` | `RequestParams.get(req, ...)` | Keep fork param normalization. |
| Sessions & auth | Signed `httpOnly` `sameSite: 'lax'` cookies, CSRF double-submit cookie, SHA-256 projection keys, DB-row HMAC session stamps (PR #42), `RateLimiter` | Session stamps (#1212), MD5 projection keys | Keep signed/CSRF cookies, SHA-256 keys, `RateLimiter`, and `ErrorInterceptor` 401 guard. |
| OIDC | `openid-client` 6, `AUD2` `(oidcIssuer, oidcSubject)` binding, blocks auto-bind to Admin/Developer, `urlBase` redirect | `openid-client` 6, `strictLinkMaxRole`, `Config.Server.getAppUrl()` | Keep fork `AUD2` binding rules and `RateLimiter` on `OIDCRouter`. |
| First admin | Random bootstrap password written to `admin-bootstrap.txt` | `admin` / `admin` | Keep `admin-bootstrap.txt`. |
| DB schema | `DatabaseMigrations` (in-place migrations with backup) | Drop and rebuild on version change | Keep `DatabaseMigrations`; never drop user DBs. |
| Uploads | `multer.memoryStorage`, 50 MiB/file, 10 files, 5 concurrent, `wx` exclusive writes | Temp-folder storage (#1378) | Keep `SafePath`, `wx`, concurrency semaphore, 50 MiB default when porting #1378. |
| Frontend components | Constructor-injected with RxJS & `ChangeDetectionStrategy.Eager` (mostly) | Signals, `inject()`, `computed()` | Apply behavior changes in the fork's existing component style. |
| Error codes | No `DIRECTORY_NOT_FOUND` (until #1205) | Has `DIRECTORY_NOT_FOUND` (#1205) | Omit `#1205`-dependent hunks until `#1205` is ported; note in PR. |
| Tests | Mocha backend (SQLite + MariaDB), Vitest frontend, Cypress e2e | Mocha backend, Jasmine-style specs, Playwright e2e | Drop upstream Jasmine/Playwright specs; write Vitest/Mocha equivalents. |
| Translations & release notes | Keep fork `.xlf` files; no `RELEASE_NOTES.md` | Updates `.xlf` and `RELEASE_NOTES.md` | `git rm RELEASE_NOTES.md`; `git checkout HEAD -- src/frontend/translate/` unless updating translations. |

## Porting Workflow

### 1. Check for new upstream commits

```bash
node scripts/upstream-status.mjs --fetch
```

Review any new upstream commits/PRs since the watermark in [Upstream-Ledger.md](Upstream-Ledger.md) and categorize them as **Planned**, **Deferred**, or **Obsolete / Skipped** before updating the watermark.

### 2. Branch from `origin/master`

```bash
git fetch origin && git fetch upstream master
git switch -c port/upstream-<pr-or-topic> origin/master
```

Never commit directly to `master`. Use one branch per candidate (or per tightly related group).

### 3. Find the PR's own commits (and follow-ups)

```bash
m=$(git log --merges --format=%H --grep="Merge pull request #<PR> " dc456950..upstream/master | head -1)
b=$(git merge-base $m^1 $m^2)
git log --no-merges --reverse --format='%H %an | %s' $b..$m^2
# Check for later upstream fixes touching the same files:
git log --oneline $m..upstream/master -- <files>
```

### 3a. Post an impact report and wait for approval

Before changing any code, report to the user what the port changes, its impact on the current fork behavior, regression risks and any scope change against the plan. Then wait for approval. The required contents are in [Upstream-Port-Packs.md](Upstream-Port-Packs.md#impact-report-before-any-code-mandatory-for-every-pack).

### 4. Cherry-pick (preserving authorship) or adapt

```bash
git cherry-pick -x <commit>
```

- `git cherry-pick --continue` preserves the original upstream author.
- Drop upstream-only files: `RELEASE_NOTES.md`, `test/playwright/*`, deleted Jasmine `*.spec.ts` (`DU` conflicts), and specs depending on upstream-only helpers (`KnownFailures`, `TestHelper.resetConfig`).
- When a commit cannot be cherry-picked cleanly, implement it by hand with the original author and a full-hash trailer:
  ```bash
  git commit --author="Author Name <email>"
  # End commit message with:
  # (adapted from commit <full 40-char upstream hash>)
  ```
- Fork-only follow-ups (docs, ledger updates, fork-specific config) get their own commit under the user's name.
- Fold small corrections (missing imports, test adjustments) into the commit they belong to instead of stacking fix commits:
  ```bash
  git commit --fixup=<commit>
  GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash origin/master
  ```

### 5. Mandatory Testing Rules

Every port PR must include appropriate automated tests for the migrated behavior:

- **Backend changes:** Port upstream Mocha unit/integration tests where applicable, and update or add fork-specific specs (e.g. `UserMWs.spec.ts`, `OIDCAuthService.spec.ts`, `AuthenticationMWs.spec.ts`) to cover fork-specific middleware/security wiring.
- **Frontend changes:** Upstream's Jasmine and Playwright specs do not carry over. **Every** hand-adapted frontend behavior must add a **Vitest** spec (run both focused and alongside related specs, since Vitest bundles specs together).
- **Full verification gate before opening a PR** (prefix with `source ~/.nvm/nvm.sh && nvm use >/dev/null &&` in every new shell):

```bash
npm run build-backend
npx tsc -p src/frontend/tsconfig.spec.json --noEmit
npm run build-en
npx ng lint
npx ng test --watch=false
```

Backend full suite against **both SQLite and MariaDB**:

```bash
podman start pigallery-db
podman exec pigallery-db healthcheck.sh --connect --innodb_initialized
rm -f test/tmp/config.json
MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USERNAME=pigallery MYSQL_PASSWORD=password \
TEST_MYSQL=true PORT=35000 CI=true npx mocha --no-config --require ./test/root-hooks.cjs \
  --recursive --timeout=20000 --exclude 'test/cypress/**/*.js' --exclude test/folder-reset.js \
  test > /tmp/pg-tests.log 2>&1
grep -E 'passing|failing|^\s+[0-9]+\) ' /tmp/pg-tests.log
```

**Known pitfalls:**
- `PublicRouter` › Built-in Prism theme (`data-gallery-design="legacy"`) may fail on `master` too — verify against `master` if seen.
- Deleting a `.spec.ts` leaves behind compiled `.js` / `.js.map` files that Mocha will still load; delete them too.
- Tests setting `Config.Users.authenticationRequired = false` must restore it, or later suites (e.g. `UploadRouter`) fail.
- New SQL test galleries must call `await ObjectManagers.getInstance().init()` after `DBTestHelper.persistTestDir`.
- If MariaDB `pigallery2_test` was left at a newer schema version by another branch/tool, drop and recreate `pigallery2_test` in `pigallery-db`.
- With `typeconfig` 2.5.0, constraints on server-only properties of a client config subclass must accept `undefined`.

### 6. Container / Browser Verification

For auth, session, upload, or UI changes, verify in the user's 8086 test container. **Always warn the user before running this script** because it replaces `pigallery25-test` and wipes its `db`, `tmp`, and `config` folders (and requires the branch to be pushed to `origin` first):

```bash
cd "/mnt/Duzy/git/disk_troubleshooting/Nuc Lab/apps/pigallery2-dev"
./run-test-container-pigallery25.sh <branch> --port 8086 \
  --media /home/michalwalczak/media/pigallery25 \
  --data /home/michalwalczak/.cache/pigallery25-test --no-seed
```

The generated admin password is in `/home/michalwalczak/.cache/pigallery25-test/db/admin-bootstrap.txt`.

### 7. Update Ledger, Push & Open PR

- Update [Upstream-Ledger.md](Upstream-Ledger.md) (move items from **Planned** to **Ported** with fork PR #, and note any **Obsolete / Skipped** hunks).
- Push and open PRs **only when the user asks**, to `origin` only, targeting `GitchalWoo/pigallery2.5` `master`.
- Include in the PR description: a table of ported upstream PRs/commits with adaptation notes, a **Skipped** list with reasons, and full test results (including anything not tested).
