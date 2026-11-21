#!/usr/bin/env node
/**
 * Reports upstream bpatrik/pigallery2 commits since the watermark recorded in
 * docs/fork-features/Upstream-Ledger.md, plus a count of commits already
 * referenced via cherry-pick / adapted-from trailers in this fork.
 *
 * Usage:
 *   node scripts/upstream-status.mjs [--fetch] [--all]
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const args = new Set(process.argv.slice(2));
const LEDGER_PATH = resolve('docs/fork-features/Upstream-Ledger.md');
const COMMON_ANCESTOR = 'dc456950';

const git = (gitArgs) =>
  execFileSync('git', gitArgs, {encoding: 'utf8'}).trim();

if (args.has('--fetch')) {
  console.log('Fetching upstream master...');
  execFileSync('git', ['fetch', 'upstream', 'master'], {stdio: 'inherit'});
}

const ledger = readFileSync(LEDGER_PATH, 'utf8');
const watermarkMatch = ledger.match(/Last surveyed upstream commit:\*\*\s*`([0-9a-f]+)`/i);
if (!watermarkMatch) {
  console.error(`Could not find "Last surveyed upstream commit" watermark in ${LEDGER_PATH}`);
  process.exit(1);
}
const watermark = watermarkMatch[1];

const upstreamHead = git(['rev-parse', '--short', 'upstream/master']);
const upstreamDate = git(['show', '-s', '--format=%cs', 'upstream/master']);

// Collect all upstream hashes referenced by cherry-pick or adapted-from trailers in fork history
const logTrailers = git(['log', `${COMMON_ANCESTOR}..HEAD`, '--format=%B']);
const portedHashes = new Set();
for (const m of logTrailers.matchAll(/(?:cherry picked from|adapted from) commit ([0-9a-f]{7,40})/gi)) {
  portedHashes.add(m[1].slice(0, 8).toLowerCase());
}

console.log(`Ledger watermark: ${watermark}`);
console.log(`Upstream master:  ${upstreamHead} (${upstreamDate})`);
console.log(`Ported commits tracked in git trailers (since ${COMMON_ANCESTOR}): ${portedHashes.size}`);
console.log('');

const range = args.has('--all')
  ? `${COMMON_ANCESTOR}..upstream/master`
  : `${watermark}..upstream/master`;

const newCommits = git(['log', '--first-parent', '--reverse', '--format=%h\t%cs\t%s', range]);
if (!newCommits) {
  console.log(`No new upstream commits since watermark ${watermark}.`);
  process.exit(0);
}

const lines = newCommits.split('\n').filter(Boolean);
console.log(`${args.has('--all') ? 'All' : 'New'} upstream first-parent commits (${lines.length}):`);
for (const line of lines) {
  const [hash, date, ...subjectParts] = line.split('\t');
  const subject = subjectParts.join('\t');
  const inLedger = ledger.includes(hash) || (subject.match(/#(\d+)/) && ledger.includes(`#${subject.match(/#(\d+)/)[1]}`));
  const marker = portedHashes.has(hash.slice(0, 8).toLowerCase())
    ? '[ported]'
    : inLedger
      ? '[listed]'
      : '[NEW]   ';
  console.log(`  ${marker} ${hash} ${date} ${subject}`);
}
