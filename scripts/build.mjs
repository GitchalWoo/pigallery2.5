import {parseArgs} from 'node:util';
import {buildFrontend} from './tooling.mjs';
import {createBuildInfo, writeBuildInfo} from './build-info.mjs';

const {values} = parseArgs({options: {
  languages: {type: 'string'},
  'stats-json': {type: 'boolean'},
}});
const buildInfo = createBuildInfo();
await buildFrontend({languages: values.languages, statsJson: values['stats-json'], buildInfo});
if (!values['stats-json']) await writeBuildInfo(buildInfo);
