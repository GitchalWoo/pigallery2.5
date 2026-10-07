import {parseArgs} from 'node:util';
import {buildFrontend} from './tooling.mjs';

const {values} = parseArgs({options: {languages: {type: 'string'}}});
await buildFrontend({languages: values.languages});
