const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '../src');
const en = fs.readFileSync(path.join(root, 'en.ts'), 'utf8');
const keys = new Set([...en.matchAll(/^  ("(?:[^"\\]|\\.)+"): /gm)].map(match => JSON.parse(match[1])));
const missing = new Map();
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) { scan(filename); continue; }
    if (!/\.tsx?$/.test(entry.name) || entry.name === 'en.ts') continue;
    const source = fs.readFileSync(filename, 'utf8');
    const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, entry.name.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if (ts.isCallExpression(node) && node.arguments.length && ts.isIdentifier(node.expression) && ['t', 'say', 'local'].includes(node.expression.text) && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        if (!keys.has(key) && /[А-Яа-яЁё]/.test(key)) missing.set(key, filename);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
}
scan(root);
for (const [key, filename] of missing) console.log(`${path.relative(root, filename)}: ${key}`);
console.log(`Missing ${missing.size} literal t() translations`);
process.exitCode = missing.size ? 1 : 0;
