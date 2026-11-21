#!/usr/bin/env node
/**
 * Reports upstream bpatrik/pigallery2 commits since the watermark recorded in
 * docs/fork-features/Upstream-Ledger.md, plus a count of commits already
 * referenced via cherry-pick / adapted-from trailers in this fork.
 *
 * Usage:
 *   node scripts/upstream-status.mjs [--fetch] [--all | --check]
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

// PR identities live in the source column. A queue row has an order column first.
const listedPRs = new Set();
const listedHashes = new Set();
const selectiveRows = new Map();
let section = '';
for (const line of ledger.split('\n')) {
  if (line.startsWith('#')) section = line;
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').map(cell => cell.trim());
  const source = /^\d+$/.test(cells[1]) ? cells[2] : cells[1];
  for (const [, number] of source.matchAll(/#(\d+)\b/g)) listedPRs.add(number);
  const hashes = [...line.matchAll(/`([a-f0-9]{7,40})`/g)].map(match => match[1]);
  for (const hash of hashes) listedHashes.add(hash);
  if (section === '### Commit decisions within selective PRs' && /^#\d+$/.test(source)) {
    selectiveRows.set(source.slice(1), hashes);
  }
}

const mergePR = subject => /^Merge pull request #(\d+)\b/.exec(subject)?.[1];
const hasHash = (references, hash) => [...references].some(reference => hash.startsWith(reference));

if (args.has('--check')) {
  const errors = [];
  if (!selectiveRows.size) errors.push('Missing commit decisions table for selective PRs.');
  if (git(['rev-parse', watermark]) !== git(['rev-parse', 'upstream/master'])) {
    errors.push(`Watermark ${watermark} differs from upstream/master (${upstreamHead}).`);
  }
  const range = `${COMMON_ANCESTOR}..${watermark}`;
  const history = option => git(['log', option, '--format=%H%x09%s', range])
    .split('\n').filter(Boolean).map(line => line.split('\t'));
  const checkedPRs = new Set();
  for (const [merge, subject] of history('--merges')) {
    const number = mergePR(subject);
    if (!number) continue;
    checkedPRs.add(number);
    if (!listedPRs.has(number)) errors.push(`Missing PR #${number}.`);
    if (!selectiveRows.has(number)) continue;
    const commits = git(['rev-list', '--no-merges', `${merge}^1..${merge}`]);
    for (const hash of commits.split('\n').filter(Boolean)) {
      if (!hasHash(selectiveRows.get(number), hash)) {
        errors.push(`Missing ${hash.slice(0, 8)} in the selective row for #${number}.`);
      }
    }
  }
  for (const number of selectiveRows.keys()) {
    if (!checkedPRs.has(number)) errors.push(`Unknown selective PR #${number}.`);
  }
  for (const [hash, subject] of history('--first-parent')) {
    if (!mergePR(subject) && !hasHash(listedHashes, hash)) {
      errors.push(`Missing ledger entry for ${hash.slice(0, 8)} ${subject}.`);
    }
  }
  for (const error of errors) console.error(error);
  if (errors.length) process.exit(1);
  console.log(`Ledger covers upstream/master at ${watermark}: ${checkedPRs.size} PRs, ${selectiveRows.size} selective PR rows checked.`);
  process.exit(0);
}

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

const newCommits = git(['log', '--first-parent', '--reverse', '--format=%H\t%cs\t%s', range]);
if (!newCommits) {
  console.log(`No new upstream commits since watermark ${watermark}.`);
  process.exit(0);
}

const lines = newCommits.split('\n').filter(Boolean);
console.log(`${args.has('--all') ? 'All' : 'New'} upstream first-parent commits (${lines.length}):`);
for (const line of lines) {
  const [hash, date, ...subjectParts] = line.split('\t');
  const subject = subjectParts.join('\t');
  const inLedger = hasHash(listedHashes, hash) || listedPRs.has(mergePR(subject));
  const marker = portedHashes.has(hash.slice(0, 8).toLowerCase())
    ? '[ported]'
    : inLedger
      ? '[listed]'
      : '[NEW]   ';
  console.log(`  ${marker} ${hash.slice(0, 8)} ${date} ${subject}`);
}
