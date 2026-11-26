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
| Uploads | Streams to `TempFolder/upload` (P02), `Upload.maxFileSizeMB` default 50, 10 files, 5 concurrent, moves with `link()` / exclusive `wx` copy (never overwrites) | Temp-folder storage with `rename()` (#1378), 500 MB default | Keep `SafePath`, no-overwrite moves, concurrency semaphore and the 50 MB default. |
| Frontend components | Constructor-injected with RxJS & `ChangeDetectionStrategy.Eager` (mostly) | Signals, `inject()`, `computed()` | Apply behavior changes in the fork's existing component style. |
| Error codes | `DIRECTORY_NOT_FOUND` since P03a (#1205); `NOT_AUTHENTICATED_SHARING` only for requests with a sharing key | `DIRECTORY_NOT_FOUND` (#1205); `NOT_AUTHENTICATED_SHARING` for every unauthenticated request | Port `#1205`-dependent hunks. Keep `NOT_AUTHENTICATED` for requests without a sharing key. |
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
git switch -c port/upstream-<pack-or-topic> origin/master   # packs: port/upstream-p<NN>-<topic>
```

- Never commit port work directly to `master`.
- One branch and one PR per pack from [Upstream-Port-Packs.md](Upstream-Port-Packs.md), or per candidate outside the packs. Never combine two packs in one PR.
- Start a pack only after the packs it depends on are merged.

### 3. Find the PR's own commits (and follow-ups)

```bash
m=$(git log --merges --format=%H --grep="Merge pull request #<PR> " dc456950..upstream/master | head -1)
b=$(git merge-base $m^1 $m^2)
git log --no-merges --reverse --format='%H %an | %s' $b..$m^2
# Check for later upstream fixes touching the same files:
git log --oneline $m..upstream/master -- <files>
```

### 3a. Presence check

Several upstream commits may already be in the fork, hand-ported without trailers (mostly in PR #41 and PR #45). For each commit in scope:

- Read the upstream diff (`git show <hash> -- src test docs`) and the fork code it touches.
- Check whether the behavior already exists on `master`.
- If it does, port nothing. Move it to **Obsolete / Skipped** in the ledger with the reason "Already in fork via PR #NN".
- If only part of it exists, port the missing part and say so in the impact report and the PR.
- Dry-run the conflicts without touching the working tree:
  ```bash
  git merge-tree --write-tree --name-only --merge-base=<hash>^ origin/master <hash>
  ```

### 3b. Impact report — post it and wait for approval

Before writing or cherry-picking any code, post an **impact report** to the user and **wait for approval**. Until then, only research is allowed (steps 1–3a); do not change files.

The report covers:

1. **What changes.** Per commit:
   - the user-visible behavior;
   - the fork files and modules it touches;
   - whether it will be cherry-picked, adapted, or was found already present.
2. **Impact on the current solution.**
   - What existing fork behavior changes, including defaults, config keys, API responses and error codes, UI flows and styling.
   - Effects on stored data, on existing configurations, and on Docker or nginx setups.
3. **Regression risks.**
   - Which fork hardening or fork-only features the change touches: the conflict-rule table above, plus Prism, Zone.js, `LightboxGesturesDirective` and the PR #45 grid.
   - What could break, and which tests will cover it, both existing tests and the new ones planned.
4. **Scope changes** against the plan in [Upstream-Port-Packs.md](Upstream-Port-Packs.md):
   - commits already in the fork;
   - commits needing hunks from another pack;
   - a pack too large and needing a split;
   - a pre-made decision that does not fit the code;
   - extra work found (migrations, config renames, docs).

   Say what is proposed instead.
5. **Open questions**, each with a recommended answer.

Keep it compact: a table per commit plus short bullet lists. After approval, proceed as reported. If the scope or a risk turns out different during the work, stop and post a short report update before continuing.

**Stop and ask the user** at any point if:
- a change would weaken the fork's hardening (see the conflict-rule table above);
- upstream styling would override the Prism design;
- a pre-made decision in [Upstream-Port-Packs.md](Upstream-Port-Packs.md) turns out to be wrong for the fork's code;
- a change needs a database schema change outside the pack that is allowed to make one.

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
- Restore `.xlf` churn: `git checkout HEAD -- src/frontend/translate/`.
- Apply frontend behavior in the fork's component style: constructor injection, RxJS, `ChangeDetectionStrategy.Eager`. Do not migrate components to signals.
- Config additions update `docs/user-guide/configuration.md` in the same commit (the fork has no `ConfigTypes.snapshot.json`).
- Replace upstream Playwright tests with Vitest (frontend) or Mocha (backend) tests of the same behavior.
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

`npx ng lint` lints `src/` and `test/` and must report **0 errors**. The template accessibility rules are errors. Warnings (explicit `any`) are tracked in Techdebt T8; do not add new ones in ported code.

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

For UI changes, also check the behavior in a browser: `npm run build-en`, then `npm start -- --Server-port=8081` (use 8082 if 8081 is busy). List each check in the PR.

For auth, session, upload, or UI changes, also verify in a local test container (e.g. on port 8086) built from the pushed branch. **Always warn the user before running any destructive test-container reset/deploy script** that wipes its `db`, `tmp`, and `config` directories. The generated admin password is written to `<data-dir>/db/admin-bootstrap.txt`.

### 7. Update Ledger, Push & Open PR

1. Update [Upstream-Ledger.md](Upstream-Ledger.md):
   - move items to **Ported** with the fork PR number, or to **Obsolete / Skipped** with the reason;
   - update the pack's row in the Planned table and the matching rows of "Commit decisions within selective PRs";
   - run `node scripts/upstream-status.mjs --fetch --check`; it must pass.
2. Push and open PRs **only when the user asks** (a pack handover that says so counts). Push to `origin` only, targeting `GitchalWoo/pigallery2.5` `master`.
   - Branch: `git push -u origin <branch>`.
   - Title: `port(upstream): P<NN> <pack topic> (#<upstream PRs>)`.
3. The PR description contains:
   - the **final impact report**: the approved report from step 3b, updated, with every difference from the approved version marked;
   - a table of ported upstream commits: hash, upstream PR, fork commit, cherry-picked or adapted, adaptation notes;
   - a **Skipped / already in fork** list with reasons;
   - security-relevant adaptations, called out explicitly for review;
   - full test results: Vitest count, Mocha passing/failing on SQLite and MariaDB, lint, build, browser and container checks. State anything not tested and why.
4. After the PR exists, put its number into the ledger's **Ported** rows, commit, and push.
5. Do **not** merge. Report the PR link and a short summary to the user, including anything the user should decide.
