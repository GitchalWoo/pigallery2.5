import {parseArgs} from 'node:util';
import {buildFrontend} from './tooling.mjs';

const {values} = parseArgs({options: {
  languages: {type: 'string'},
  'stats-json': {type: 'boolean'},
}});
await buildFrontend({languages: values.languages, statsJson: values['stats-json']});
