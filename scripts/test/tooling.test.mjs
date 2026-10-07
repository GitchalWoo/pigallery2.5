import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {localizeBundles} from '../tooling.mjs';
import {releasePackage} from '../release.mjs';

test('localized bundles match each index and repeat safely without touching assets', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pg-bundles-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  for (const locale of ['en', 'pl']) {
    await mkdir(path.join(dir, locale));
    await writeFile(path.join(dir, locale, 'index.html'), '<link rel="modulepreload" href="chunk-ABC.js"><script src="main-ABC.js" type="module"></script><script src="polyfills-ABC.js" type="module"></script>');
    await writeFile(path.join(dir, locale, 'main-ABC.js'), 'import "./chunk-ABC.js";');
    await writeFile(path.join(dir, locale, 'chunk-ABC.js'), 'export const value = 1;');
  }
  await mkdir(path.join(dir, 'assets'));
  await localizeBundles(dir);
  await localizeBundles(dir);
  for (const locale of ['en', 'pl']) {
    assert.equal(await readFile(path.join(dir, locale, 'index.html'), 'utf8'), `<link rel="modulepreload" href="chunk-ABC.js"><script src="${locale}.main-ABC.js" type="module"></script><script src="polyfills-ABC.js" type="module"></script>`);
    assert.equal(await readFile(path.join(dir, locale, `${locale}.main-ABC.js`), 'utf8'), 'import "./chunk-ABC.js";');
    assert.deepEqual((await readdir(path.join(dir, locale))).sort(), [`${locale}.main-ABC.js`, 'chunk-ABC.js', 'index.html'].sort());
  }
});

const source = {
  name: 'pigallery2',
  dependencies: {sharp: '0.35.5'},
  optionalDependencies: {'ffmpeg-static': '5.2.0', 'ffprobe-static': '3.1.0', mysql2: '3.24.5'},
  devDependencies: {typescript: '6.0.3'},
  scripts: {build: 'development only', start: 'start'},
};

test('Docker release skips bundled FFmpeg and requires mysql2 without mutating the source', () => {
  const original = structuredClone(source);
  const pkg = releasePackage(source, {skipOptional: 'ffmpeg-static,ffprobe-static', forceOptional: true, buildCommitHash: 'commit'});
  assert.deepEqual(pkg.dependencies, {sharp: '0.35.5', mysql2: '3.24.5'});
  assert.equal(pkg.optionalDependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(pkg.scripts, {start: 'node ./src/backend/index.js'});
  assert.equal(pkg.buildCommitHash, 'commit');
  assert.ok(!Number.isNaN(Date.parse(pkg.buildTime)));
  assert.deepEqual(source, original);
});

test('ordinary releases preserve optional dependencies', () => {
  const pkg = releasePackage(source);
  assert.deepEqual(pkg.optionalDependencies, source.optionalDependencies);
  assert.deepEqual(pkg.dependencies, source.dependencies);
});

test('release skip flags accept space-separated package patterns', () => {
  const pkg = releasePackage(source, {skipOptional: 'ffmpeg ffprobe'});
  assert.deepEqual(pkg.optionalDependencies, {mysql2: '3.24.5'});
});
