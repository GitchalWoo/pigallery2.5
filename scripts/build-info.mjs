import {execFileSync} from 'node:child_process';
import {readFileSync, realpathSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {root} from './tooling.mjs';

const repositoryUrl = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).homepage;

export function createBuildInfo(sourceDir = root) {
  let buildCommitHash;
  let dirty = false;
  try {
    const git = args => execFileSync('git', args, {
      cwd: sourceDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    buildCommitHash = git(['rev-parse', 'HEAD']);
    dirty = !!git(['status', '--porcelain', '--untracked-files=normal']);
  } catch {
    // Git is optional: source archives can still be built.
  }
  return {
    appVersion: `pigallery2.5@${buildCommitHash ? buildCommitHash.slice(0, 8) : 'source'}${dirty ? '-dirty' : ''}`,
    appVersionUrl: repositoryUrl,
    buildTime: new Date().toISOString(),
    ...(buildCommitHash ? {buildCommitHash} : {}),
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === path.join(root, 'scripts/build-info.mjs')) {
  await writeFile(path.join(root, 'build-info.json'), JSON.stringify(createBuildInfo(), null, 2) + '\n');
}
