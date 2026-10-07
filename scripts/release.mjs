import {execFileSync} from 'node:child_process';
import {createWriteStream, realpathSync} from 'node:fs';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {parseArgs} from 'node:util';
import archiver from 'archiver';
import {buildFrontend, root, runTool} from './tooling.mjs';

export function releasePackage(source, {skipOptional = '', forceOptional = false, buildTime, buildCommitHash} = {}) {
  const pkg = structuredClone(source);
  delete pkg.devDependencies;
  delete pkg.c8;
  pkg.scripts = {start: 'node ./src/backend/index.js'};
  const skipped = skipOptional.split(/[ ,]+/).filter(Boolean);
  for (const name of Object.keys(pkg.optionalDependencies || {})) {
    if (skipped.some(pattern => name.includes(pattern))) delete pkg.optionalDependencies[name];
  }
  if (forceOptional) {
    Object.assign(pkg.dependencies, pkg.optionalDependencies);
    delete pkg.optionalDependencies;
  }
  pkg.buildTime = buildTime || new Date().toISOString();
  if (buildCommitHash) pkg.buildCommitHash = buildCommitHash;
  return pkg;
}

export async function createRelease(options = {}) {
  const releaseDir = path.join(root, 'release');
  await rm(releaseDir, {recursive: true, force: true});
  await mkdir(releaseDir, {recursive: true});
  await buildFrontend({outputPath: 'release/dist', languages: options.languages, release: true});
  await runTool('typescript/bin/tsc', ['--project', 'tsconfig.release.json']);
  for (const file of ['README.md', 'LICENSE', 'src/backend/model/diagnostics/image_formats', 'src/backend/model/diagnostics/blank.jpg']) {
    const target = path.join(releaseDir, file);
    await mkdir(path.dirname(target), {recursive: true});
    await cp(path.join(root, file), target, {recursive: true});
  }
  let buildCommitHash;
  try {
    buildCommitHash = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    // Source archives may not include Git metadata.
  }
  const source = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await writeFile(path.join(releaseDir, 'package.json'), JSON.stringify(releasePackage(source, {...options, buildCommitHash}), null, 2) + '\n');
  const archive = archiver('zip', {zlib: {level: 9}});
  const output = pipeline(archive, createWriteStream(path.join(root, 'pigallery2.zip')));
  archive.glob('**/*', {cwd: releaseDir, dot: true, nodir: true});
  await Promise.all([output, archive.finalize()]);
  console.log('Release ready: release/ and pigallery2.zip');
}

if (process.argv[1] && realpathSync(process.argv[1]) === path.join(root, 'scripts/release.mjs')) {
  const {values} = parseArgs({options: {
    languages: {type: 'string'},
    'skip-opt-packages': {type: 'string'},
    'force-opt-packages': {type: 'boolean'},
  }});
  await createRelease({languages: values.languages, skipOptional: values['skip-opt-packages'], forceOptional: values['force-opt-packages']});
}
