import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const pkg = JSON.parse(await readFile('package.json')), manifest = JSON.parse(await readFile('ez-plugin.json'));
assert.equal(manifest.id, 'slack'); assert.equal(manifest.version, pkg.version);
assert.equal(pkg.private, false);
assert.match(pkg.version, /^\d+\.\d+\.\d+-beta\.\d+(?:\.rc\.\d+)?$/);
assert.deepEqual(pkg.publishConfig, {access:'public', tag:'latest', registry:'https://registry.npmjs.org/'});
assert.equal(pkg.dependencies['@slack/socket-mode'], '3.0.1');
assert.equal(pkg.dependencies['@jc_stack/ez-agents'], '0.1.0-beta.42');
assert.equal(await readFile('pnpm-lock.yaml', 'utf8'), await readFile('docker/pnpm-lock.yaml', 'utf8'));
assert.equal(manifest.usageHint, undefined, 'Snippet unnecessary: help/skill own tool mechanics');
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {encoding:'utf8'}));
const files = packed.files.map(f => f.path);
for (const f of ['Dockerfile', '.dockerignore', 'ez-plugin.json', 'ez-deployment.json', 'src/commands.mjs', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md', 'AGENTS.md', 'docker/pnpm-lock.yaml', 'skills/slack/SKILL.md', 'bin/ez-slack.mjs', 'web/setup.html']) { await access(f); assert(files.includes(f), `Package missing ${f}`); }
assert(!files.some(f => /(?:^|\/)(?:node_modules|\.git|\.env|connection\.json|slack\.json|receipts\.json)(?:\/|$)/.test(f)), 'Private/generated data in package');
console.log('Package identity, files, private-state exclusion, lockfile and snippet checks passed.');
