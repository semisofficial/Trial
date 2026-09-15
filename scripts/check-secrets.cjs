// Heuristic guard, not a full historical secret scanner. Never prints file contents.
const { execFileSync } = require('node:child_process');
const { readFileSync, lstatSync } = require('node:fs');
const path = require('node:path');

try {
  const staged = process.argv.includes('--staged');
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const files = [...new Set(git(['ls-files', '-z', '--cached', ...(staged ? [] : ['--others', '--exclude-standard'])]).toString().split('\0').filter(Boolean))];
  const patterns = [
    ['database credential', /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i],
    ['private key payload', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{40,}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['Resend key', /\bre_[A-Za-z0-9]{20,}\b/],
    ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ];
  let findings = 0;
  for (const file of files) {
    const report = reason => { findings++; console.log(`${JSON.stringify(file)}: ${reason} (value redacted)`); };
    const name = path.basename(file);
    if (/^\.env(?:\.|$)/i.test(name) && !/^\.env\.(?:example|sample|template)$/i.test(name)) {
      report('environment file must not be tracked'); continue;
    }
    let data;
    if (staged) data = git(['show', `:${file}`]);
    else {
      const full = path.join(root, file);
      let stat;
      try { stat = lstatSync(full); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (stat.isSymbolicLink()) { report('symlink requires manual review'); continue; }
      data = readFileSync(full);
    }
    if (data.includes(0)) continue; // Binary assets are outside this text-only check.
    const content = data.toString('utf8');
    for (const [reason, pattern] of patterns) {
      // Permit only explicit sample strings, not entire .env.example files.
      const sanitized = content
        .replace(/postgresql:\/\/user:pass@(?:test\.example\/test|localhost:543[23]\/(?:test|semis_test))/g, '')
        .replaceAll('postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=verify-full', '')
        .replaceAll('re_XXXXXXXXXXXXXXXXXXXX', '');
      if (pattern.test(sanitized)) report(reason);
    }
  }
  console.log(`Secret guard: ${files.length} files checked; ${findings} finding(s). ${staged ? 'Git index' : 'Working files'} only; history and binary content are not scanned.`);
  process.exitCode = findings ? 1 : 0;
} catch {
  console.error('Secret guard could not finish. Check repository/file access; no file contents were printed.');
  process.exitCode = 2;
}
