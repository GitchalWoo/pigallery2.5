import {createRequire} from 'node:module';
import path from 'node:path';
import {root} from './tooling.mjs';

// Resolve the DevKit paired with our CLI, including when npm nests it.
const cliRequire = createRequire(path.join(root, 'node_modules/@angular/cli/package.json'));
const {Architect} = cliRequire('@angular-devkit/architect');
const {WorkspaceNodeModulesArchitectHost} = cliRequire('@angular-devkit/architect/node');
const {json, logging, workspaces} = cliRequire('@angular-devkit/core');
const {NodeJsSyncHost} = cliRequire('@angular-devkit/core/node');
const {workspace} = await workspaces.readWorkspace(root, workspaces.createWorkspaceHost(new NodeJsSyncHost()));
const registry = new json.schema.CoreSchemaRegistry();
registry.addPostTransform(json.schema.transforms.addUndefinedDefaults);
const architect = new Architect(new WorkspaceNodeModulesArchitectHost(workspace, root), registry);
const logger = new logging.Logger('frontend');
logger.subscribe(entry => (entry.level === 'error' ? console.error : console.log)(entry.message));
// The CLI exposes --localize as a boolean; Architect accepts a locale array.
const run = await architect.scheduleTarget(
  {project: 'pigallery2', target: 'build', configuration: 'production'},
  {...JSON.parse(process.argv[2]), progress: false},
  {logger}
);
try {
  const result = await run.lastOutput;
  if (!result.success) throw new Error(result.error || 'Frontend build failed');
} finally {
  await run.stop();
}
