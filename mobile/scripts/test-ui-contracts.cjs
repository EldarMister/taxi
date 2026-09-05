const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');

// React Native rejects even a single inline JSX space inside a View. This
// catches the regression which appeared when opening the trip history screen.
test('native UI never renders a bare text node outside Text', () => {
  const root = path.resolve(__dirname, '..');
  const files = [path.join(root, 'App.tsx')];
  function collect(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.isDirectory()) collect(path.join(directory, item.name));
      else if (item.name.endsWith('.tsx')) files.push(path.join(directory, item.name));
    }
  }
  collect(path.join(root, 'src'));
  const violations = [];
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function insideText(node) {
      let parent = node.parent;
      if (ts.isJsxExpression(parent)) parent = parent.parent;
      while (parent && ts.isJsxFragment(parent)) parent = parent.parent;
      return parent && ts.isJsxElement(parent) && ['Text', 'Animated.Text', 'Svg.Text'].includes(parent.openingElement.tagName.getText(source));
    }
    function visit(node) {
      const bareJsx = ts.isJsxText(node) && (node.text.trim() || (node.text.length > 0 && !/[\r\n]/.test(node.text)));
      const bareExpression = ts.isStringLiteral(node) && ts.isJsxExpression(node.parent) && node.text.length > 0;
      if ((bareJsx || bareExpression) && !insideText(node)) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push(`${path.relative(root, file)}:${position.line + 1}: ${JSON.stringify(node.text)}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(violations, []);
});
