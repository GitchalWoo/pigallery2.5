import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {root, runTool} from './tooling.mjs';

const {values, positionals} = parseArgs({allowPositionals: true, options: {
  languages: {type: 'string'},
}});
const [task, language] = positionals;
if (!['extract', 'merge', 'update', 'add'].includes(task)) {
  throw new Error('Choose extract, merge, update, or add <language>.');
}
const files = await readdir(path.join(root, 'src/frontend/translate'));
const existing = files.filter(file => /^messages\.[a-z]+(?:-[a-z]+)?\.xlf$/i.test(file)).map(file => file.split('.')[1]);
let languages = values.languages ? values.languages.split(',').map(value => value.trim()) : existing;
if (task === 'add') {
  if (!language || !/^[a-z]+(?:-[a-z]+)?$/i.test(language)) throw new Error('Provide a language code, e.g. npm run add-translation -- fi');
  if (existing.includes(language)) throw new Error(`Translation already exists: ${language}`);
  languages = [language];
}
await runTool('@angular/cli/bin/ng.js', ['extract-i18n', '--out-file=locale.source.xlf', '--format=xlf']);
if (task !== 'extract') {
  const args = [
    '--source-lang=en', '--source-file=./locale.source.xlf', '--destination-filename=messages',
    '--destination-folder=./src/frontend/translate', `--destination-languages=${JSON.stringify(languages)}`,
  ];
  if (task === 'merge') args.push('--method=extend-only');
  await runTool('xlf-google-translate/cli.js', args);
}
