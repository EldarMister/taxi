import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(resolve(root, 'package.json'));

// Use the website's actual React content, including tables and contact links.
// The generated mobile copy is also readable offline; never maintain two policies.
function serialize(value) {
  if (value == null || typeof value === 'boolean') return [];
  if (Array.isArray(value)) return value.flatMap(serialize);
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (typeof value.type === 'function') return serialize(value.type(value.props));
  if (typeof value.type === 'symbol') return serialize(value.props.children);
  if (typeof value.type !== 'string' || value.type === 'svg') return [];
  return [{ tag: value.type, ...(value.props.href ? { href: value.props.href } : {}), children: serialize(value.props.children) }];
}

async function writeChanged(path, content) {
  if (await readFile(path, 'utf8').catch(() => '') !== content) await writeFile(path, content);
}

export async function exportLegalDocuments() {
  const source = await readFile(resolve(root, 'src/LegalPage.jsx'), 'utf8');
  const { code } = await transformWithEsbuild(source, 'LegalPage.jsx', { loader: 'jsx', format: 'cjs', target: 'es2022' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  const documents = Object.fromEntries(Object.entries(module.exports.legalDocuments).map(([kind, document]) => [kind, {
    title: document.title, date: document.date,
    sections: document.sections.map(section => ({ title: section.title, body: serialize(section.body) })),
  }]));
  const json = `${JSON.stringify(documents, null, 2)}\n`;
  // A website-only deployment does not contain the mobile workspace.
  await writeChanged(resolve(root, '../mobile/src/legalDocumentsContent.json'), json).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  await writeChanged(resolve(root, 'public/legal-documents.json'), json);
  return documents;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await exportLegalDocuments();
