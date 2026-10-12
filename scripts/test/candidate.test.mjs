import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCandidateGate, MANDATORY_CHECKS, testReportCounts, digestCandidateFiles } from '../lib/candidate.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const expected = { commit: 'a'.repeat(40), sourceDigest: 'sha256:' + 'b'.repeat(64) };
const valid = () => ({ ...expected, checks: MANDATORY_CHECKS.map(name => ({ name, ...expected, status: 'passed', exitCode: 0, testCount: 1, skipped: 0, cancelled: 0, todo: 0 })) });
test('all mandatory check records must succeed for the identical candidate', () => { assert.equal(assertCandidateGate(valid(), expected), true); });
test('missing, failed, skipped, cancelled and different candidate checks block release', () => {
  for (const change of [record => record.checks.pop(), record => record.checks[0].status = 'cancelled', record => record.checks[0].status = 'skipped', record => record.checks[0].exitCode = 1,
    record => record.checks[0].skipped = 1, record => record.checks[0].cancelled = 1, record => record.checks[0].todo = 1,
    record => record.checks[1].testCount = 0, record => record.checks[0].sourceDigest = 'sha256:wrong', record => record.sourceDigest = 'sha256:wrong', record => record.commit = 'wrong']) {
    const record = valid(); change(record); assert.throws(() => assertCandidateGate(record, expected));
  }
});
test('TAP and Node24 spec summaries both detect skipped and cancelled mandatory tests', () => {
  assert.deepEqual(testReportCounts('# tests 3\n# skipped 1\n# cancelled 0\n# todo 0\nℹ tests 2\nℹ skipped 0\nℹ cancelled 1\nℹ todo 1\n'), { testCount: 5, skipped: 1, cancelled: 1, todo: 1 });
});
test('candidate fingerprint records tracked deletion separately from absent inventory and restored file', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-candidate-deletion-'));
  try {
    const deleted = digestCandidateFiles(root, ['deleted-source.ts']);
    assert.notEqual(deleted, digestCandidateFiles(root, []));
    assert.equal(deleted, digestCandidateFiles(root, ['deleted-source.ts']));
    assert.throws(() => digestCandidateFiles(root, ['../outside.ts']), /candidate root/);
    writeFileSync(join(root, 'deleted-source.ts'), 'restored source');
    assert.notEqual(deleted, digestCandidateFiles(root, ['deleted-source.ts']));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('candidate rejects a source symlink or Windows directory junction', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-candidate-symlink-'));
  try {
    mkdirSync(join(root, 'target'));
    writeFileSync(join(root, 'target/data.ts'), 'source');
    symlinkSync(join(root, 'target'), join(root, 'source-link'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => digestCandidateFiles(root, ['source-link']), /symbolic links/);
    assert.throws(() => digestCandidateFiles(root, ['source-link/data.ts']), /symbolic-link parents/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
