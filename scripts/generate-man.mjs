import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {root} from './tooling.mjs';

const require = createRequire(import.meta.url);
const {PrivateConfigClass} = require('../src/common/config/private/PrivateConfigClass.js');
const {ConfigClassBuilder} = require('typeconfig/node');
const {PG2ConfMap, ServerPG2ConfMap} = require('../src/common/PG2ConfMap.js');

const defCFG = ConfigClassBuilder.attachInterface(new PrivateConfigClass());
defCFG.Server.sessionSecret = [];
let txt = '# Pigallery 2 man page\n';
txt +=
  'pigallery2 uses [typeconfig](https://github.com/bpatrik/typeconfig) for configuration\n\n';
txt += '`npm start -- --help` prints the following:\n\n';
txt +=
  '```\n' +
  ConfigClassBuilder.attachPrivateInterface(defCFG).__printMan() +
  '```';
txt += '\n\n ### `config.json` sample:\n\n';
txt += '```json\n' + JSON.stringify(defCFG, null, 4) + '\n```\n';

// Generate directory configurations man page section
const getDesc = (filename, side) => {
  if (filename === '.uploader.pg2conf') {
    return 'Whitelists the directory for file uploads. When enforced, users can only upload files to directories containing this file.';
  }
  if (filename === '.saved_searches.pg2conf') {
    return 'Stores saved searches (logical albums) at the directory level. These searches survive database resets and are loaded during directory indexing.';
  }
  if (filename === '.order_random.pg2conf') {
    return 'Forces the directory contents to be sorted in a random order.';
  }
  if (filename.startsWith('.order_descending_') && filename.endsWith('.pg2conf')) {
    const method = filename.substring('.order_descending_'.length, filename.length - '.pg2conf'.length);
    return `Forces the directory contents to be sorted by ${method} in descending order.`;
  }
  if (filename.startsWith('.order_ascending_') && filename.endsWith('.pg2conf')) {
    const method = filename.substring('.order_ascending_'.length, filename.length - '.pg2conf'.length);
    return `Forces the directory contents to be sorted by ${method} in ascending order.`;
  }
  return `Unknown ${side.toLowerCase()}-side configuration behavior.`;
};

txt += '\n## Supported Directory Configuration (`.pg2conf`) Files\n\n';
txt += 'The following files can be placed in gallery directories to customize behavior (such as sorting, file upload permissions, and saved searches):\n\n';
txt += '| File Name | Processing Side | Description |\n';
txt += '| --- | --- | --- |\n';

// Gather client side files dynamically
const clientFiles = [];
for (const category of Object.keys(PG2ConfMap)) {
  const subMap = PG2ConfMap[category];
  for (const filename of Object.keys(subMap)) {
    clientFiles.push(filename);
  }
}
clientFiles.sort();

for (const filename of clientFiles) {
  txt += `| \`${filename}\` | Client | ${getDesc(filename, 'Client')} |\n`;
}

// Gather server side files dynamically
const serverFiles = Object.keys(ServerPG2ConfMap);
serverFiles.sort();

for (const filename of serverFiles) {
  txt += `| \`${filename}\` | Server | ${getDesc(filename, 'Server')} |\n`;
}

await fsp.writeFile(path.join(root, 'docs', 'user-guide', 'configuration.md'), txt);
