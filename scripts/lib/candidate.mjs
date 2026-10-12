import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
export const MANDATORY_CHECKS = Object.freeze(['server-build', 'server-unit', 'server-integration', 'mobile-typecheck', 'mobile-tests', 'website-build', 'website-admin-tests', 'operations-tests', 'dependency-audit']);
export function digestCandidateFiles(root, files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    if (!file || isAbsolute(file) || file.includes(':') || file.split(/[\\/]/).includes('..')) throw new Error('Release source path must stay inside the candidate root.');
    hash.update(file + '\0');
    let parent = dirname(resolve(root, file));
    while (parent !== resolve(root)) {
      try { if (lstatSync(parent).isSymbolicLink()) throw new Error('Release source inputs must not have symbolic-link parents.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      parent = dirname(parent);
    }
    let details;
    try { details = lstatSync(resolve(root, file)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('deleted\0'); continue; }
    if (details.isSymbolicLink()) throw new Error('Release source inputs must not be symbolic links.');
    if (!details.isFile()) throw new Error('Release source input is not a regular file.');
    hash.update('file\0'); hash.update(readFileSync(resolve(root, file))); hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}
export function candidateIdentity(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  const files = new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0')
    .filter(file => file && !/^docs\/SECURITY-[^/]*\.md$/i.test(file)));
  function includeRuntime(path) {
    let details; try { details = lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (details.isSymbolicLink()) throw new Error('Release runtime inputs must not be symbolic links.');
    if (details.isDirectory()) for (const name of readdirSync(path)) includeRuntime(resolve(path, name));
    else if (details.isFile()) files.add(relative(root, path).replaceAll('\\', '/'));
  }
  // These are served sources/assets, despite historical dist/ignore naming.
  for (const directory of ['web/admin/dist', 'web/public']) includeRuntime(resolve(root, directory));
  return { commit: git(['rev-parse', 'HEAD']).trim(), sourceDigest: digestCandidateFiles(root, files), dirty: git(['status', '--porcelain']).trim().length > 0 };
}
export function assertCandidateGate(evidence, expected, mandatory = MANDATORY_CHECKS) {
  if (evidence.commit !== expected.commit || evidence.sourceDigest !== expected.sourceDigest) throw new Error('Checks refer to a different release candidate.');
  for (const name of mandatory) {
    const matches = evidence.checks.filter(check => check.name === name);
    if (matches.length !== 1 || matches[0].status !== 'passed' || matches[0].exitCode !== 0
      || matches[0].skipped !== 0 || matches[0].cancelled !== 0 || matches[0].todo !== 0
      || matches[0].commit !== expected.commit || matches[0].sourceDigest !== expected.sourceDigest
      || (/(?:unit|integration|tests)$/.test(name) && !(matches[0].testCount > 0))) {
      throw new Error(`Mandatory candidate check blocked: ${name} (missing, failed, skipped, cancelled, incomplete or mismatched).`);
    }
  }
  return true;
}
export function testReportCounts(output) {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  const count = label => [...plain.matchAll(new RegExp(`(?:#|ℹ)\\s+${label}\\s+(\\d+)`, 'g'))].reduce((sum, match) => sum + Number(match[1]), 0);
  return { testCount: count('tests'), skipped: count('skipped'), cancelled: count('cancelled'), todo: count('todo') };
}
