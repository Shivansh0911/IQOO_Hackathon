/**
 * Typechecks every project in the workspace.
 *
 * Each package owns its own tsconfig because the `lib` differs and that
 * difference is load-bearing: packages/** compiles with lib ES2022 and NO DOM,
 * so `document` is a type error there, not merely a lint error. Discovering the
 * projects keeps this working as packages are added, with no edit here.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const projects = ['tsconfig.json'];

for (const group of ['packages', 'adapters', 'apps', 'tooling']) {
  const dir = path.join(root, group);
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const config = `${group}/${entry.name}/tsconfig.json`;
    if (existsSync(path.join(root, config))) projects.push(config);
  }
}

let failed = 0;
for (const project of projects) {
  const result = spawnSync('node', [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', project, '--noEmit'], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  const status = result.status ?? 1;
  console.log(`${status === 0 ? '  ok  ' : ' FAIL '} ${project}`);
  if (status !== 0) failed += 1;
}

process.exit(failed === 0 ? 0 : 1);
