import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createBuildInfo} from '../build-info.mjs';
import {releasePackage} from '../release.mjs';

async function fixture(t, withGit = true) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pg-build-info-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const git = args => execFileSync('git', args, {cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  if (withGit) {
    git(['init', '--initial-branch=build-test']);
    await writeFile(path.join(dir, '.gitignore'), '/build-info.json\n');
    await writeFile(path.join(dir, 'source.txt'), 'original');
    git(['add', '.']);
    git(['-c', 'user.name=Build Test', '-c', 'user.email=build@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  }
  return {dir, git};
}

test('clean builds identify the fork and exact commit, including detached checkouts', async t => {
  const {dir, git} = await fixture(t);
  const hash = git(['rev-parse', 'HEAD']);
  git(['checkout', '--detach', hash]);
  const info = createBuildInfo(dir);
  assert.equal(info.appVersion, `pigallery2.5@${hash.slice(0, 8)}`);
  assert.equal(info.buildCommitHash, hash);
  assert.equal(info.appVersionUrl, 'https://github.com/GitchalWoo/pigallery2.5/');
  assert.ok(!Number.isNaN(Date.parse(info.buildTime)));
  // Rebuilding must not count the generated metadata itself as a source change.
  await writeFile(path.join(dir, 'build-info.json'), JSON.stringify(info));
  assert.equal(createBuildInfo(dir).appVersion, info.appVersion);
});

test('tracked edits and untracked source files mark builds dirty', async t => {
  const {dir, git} = await fixture(t);
  await writeFile(path.join(dir, 'source.txt'), 'modified');
  assert.match(createBuildInfo(dir).appVersion, /-dirty$/);
  git(['checkout', '--', 'source.txt']);
  await writeFile(path.join(dir, 'new-source.txt'), 'new');
  assert.match(createBuildInfo(dir).appVersion, /-dirty$/);
});

test('source archives have an honest fallback without requiring Git', async t => {
  const {dir} = await fixture(t, false);
  const info = createBuildInfo(dir);
  assert.equal(info.appVersion, 'pigallery2.5@source');
  assert.equal(info.appVersionUrl, 'https://github.com/GitchalWoo/pigallery2.5/');
  assert.equal(info.buildCommitHash, undefined);
});

test('release packages retain build identity after Git metadata is removed', async t => {
  const {dir} = await fixture(t);
  const info = createBuildInfo(dir);
  const pkg = releasePackage({version: '3.6.0-edge'}, info);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
  await rm(path.join(dir, '.git'), {recursive: true, force: true});
  const shipped = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  for (const key of Object.keys(info)) assert.equal(shipped[key], info[key]);
  assert.equal(shipped.version, '3.6.0-edge');
});
