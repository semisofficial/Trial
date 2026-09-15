const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const checker = path.resolve(__dirname, '../../scripts/check-secrets.cjs');

test('secret guard rejects staged credentials without printing values and ignores local ignored files', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'semis-secret-test-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const check = (...args) => spawnSync(process.execPath, [checker, ...args], { cwd, encoding: 'utf8' });
  try {
    git('init', '--quiet');
    writeFileSync(path.join(cwd, '.gitignore'), '.env\n');
    writeFileSync(path.join(cwd, '.env'), 'SESSION_SECRET=local-only-do-not-read');
    writeFileSync(path.join(cwd, 'README.md'), 'No credentials here');
    git('add', '.');
    assert.equal(check().status, 0);
    const secret = 'fixture-secret-never-display';
    writeFileSync(path.join(cwd, 'config.js'), `const url = "${'postgresql:' + '//'}user:${secret}@localhost/test";`);
    git('add', 'config.js');
    writeFileSync(path.join(cwd, 'config.js'), '// removed only in working tree');
    const staged = check('--staged');
    assert.equal(staged.status, 1);
    assert.match(staged.stdout, /config.js/);
    assert.ok(!(staged.stdout + staged.stderr).includes(secret));
    assert.equal(check().status, 0);
    git('add', '--force', '.env');
    assert.equal(check('--staged').status, 1);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
