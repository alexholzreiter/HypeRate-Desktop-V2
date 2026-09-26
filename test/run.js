#!/usr/bin/env node
// Runs every *.test.js in this folder and prints one summary.
//   npm test            all tests
//   npm test -- lol     only the files whose name contains "lol"
// A test reports each assertion as a line starting with PASS or FAIL, and exits non-zero when
// something failed. Exit code 2 means the test skipped itself (a missing tool, for example).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const filter = process.argv[2];
const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !filter || f.includes(filter))
  .sort();

if (!files.length) {
  console.error(filter ? `No test file matches "${filter}"` : 'No test files found');
  process.exit(1);
}

let checks = 0, failures = 0, broken = 0, skipped = 0;
const started = Date.now();

for (const file of files) {
  const run = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
  const output = (run.stdout || '') + (run.stderr || '');
  const lines = output.split('\n');
  const passed = lines.filter(l => l.startsWith('PASS')).length;
  const failed = lines.filter(l => l.startsWith('FAIL')).length;
  const name = file.replace('.test.js', '').padEnd(14);

  if (run.status === 2) {
    skipped++;
    console.log(`${yellow('○')} ${name} ${dim(lines.find(l => l.startsWith('SKIP')) || 'skipped')}`);
    continue;
  }

  checks += passed + failed;
  failures += failed;

  if (failed === 0 && run.status === 0) {
    console.log(`${green('✓')} ${name} ${dim(`${passed} checks`)}`);
  } else {
    broken += failed === 0 ? 1 : 0;                  // crashed without a single FAIL line
    console.log(`${red('✗')} ${name} ${failed ? red(`${failed} of ${passed + failed} failed`) : red('crashed')}`);
    console.log(output.split('\n').map(l => '    ' + l).join('\n'));
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
const parts = [`${checks - failures}/${checks} checks passed`];
if (skipped) parts.push(`${skipped} skipped`);
console.log(`\n${failures || broken ? red('FAILED') : green('OK')}  ${parts.join(' · ')}  ${dim(`${seconds}s`)}`);
process.exit(failures || broken ? 1 : 0);
