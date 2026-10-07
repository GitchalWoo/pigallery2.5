import {readFile} from 'node:fs/promises';
import {analyzeMetafile} from 'esbuild';
import path from 'node:path';
import {root} from './tooling.mjs';

// Angular's application builder emits an esbuild metafile at the output root.
const statsPath = path.resolve(root, process.argv[2] || 'dist/browser-stats.json');
console.log(await analyzeMetafile(await readFile(statsPath, 'utf8'), {verbose: true}));
