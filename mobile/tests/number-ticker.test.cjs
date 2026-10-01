const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mountTicker(reducedMotion = false) {
  const source = fs.readFileSync(path.join(__dirname, '../src/food/NumberTicker.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  } }).outputText;
  const animations = [];
  class AnimatedValue {
    constructor(value) { this.value = value; this.stops = 0; }
    setValue(value) { this.value = value; }
    stopAnimation() { this.stops++; }
  }
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return {
      AccessibilityInfo: {
        isReduceMotionEnabled: async () => reducedMotion,
        addEventListener: () => ({ remove() {} }),
      },
      Animated: {
        Value: AnimatedValue,
        View: 'AnimatedView',
        timing: (value, config) => {
          const animation = { value, config, started: false, stopped: false };
          animations.push(animation);
          return {
            start() { animation.started = true; value.value = config.toValue; },
            stop() { animation.stopped = true; },
          };
        },
      },
      Easing: { bezier: (...points) => points },
      StyleSheet: {
        create: styles => styles,
        flatten: input => Object.assign({}, ...(Array.isArray(input) ? input : [input]).filter(Boolean)),
      },
      Text: 'Text', View: 'View',
    };
    throw Error(`Unexpected import: ${id}`);
  } });
  return { NumberTicker: exports.NumberTicker, animations };
}

test('ticker preserves place-value reels and animates only changing digits on the native driver', async () => {
  const { NumberTicker, animations } = mountTicker();
  const money = amount => `${amount.toLocaleString('ru-RU')} сом`;
  let renderer;
  await act(async () => { renderer = create(React.createElement(NumberTicker, { value: 999, format: money, style: { fontSize: 18 } })); });
  const reel = place => renderer.root.findByProps({ testID: `number-ticker-digit-${place}` });
  const units = reel(0);
  const tens = reel(1);
  const hundreds = reel(2);
  assert.equal(animations.length, 0, 'there is no entrance animation');
  await act(async () => { renderer.update(React.createElement(NumberTicker, { value: 1000, format: money, style: { fontSize: 18 } })); });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: money(1000) }).props.accessibilityRole, 'text');
  assert.equal(reel(0), units);
  assert.equal(reel(1), tens);
  assert.equal(reel(2), hundreds);
  assert.ok(reel(3), 'the thousands reel is added');
  assert.equal(animations.length, 3, 'only existing digits that changed roll');
  assert.ok(animations.every(animation => animation.started && animation.config.useNativeDriver && animation.config.duration === 240));
  assert.ok(renderer.root.findAllByProps({ testID: 'number-ticker-character-5' }).length, 'the currency suffix remains a static character');
  await act(async () => renderer.unmount());
});

test('ticker shows the new quantity immediately when Reduce Motion is enabled', async () => {
  const { NumberTicker, animations } = mountTicker(true);
  let renderer;
  await act(async () => { renderer = create(React.createElement(NumberTicker, { value: 3 })); });
  await act(async () => { renderer.update(React.createElement(NumberTicker, { value: 8 })); });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: '8' }).props.accessibilityRole, 'text');
  assert.equal(animations.length, 0);
  const reel = renderer.root.findByProps({ testID: 'number-ticker-digit-0' });
  assert.equal(reel.props.style.transform[0].translateY.value, -8 * 21);
  await act(async () => renderer.unmount());
});

test('a second change interrupts the first reel and lands on the latest value', async () => {
  const { NumberTicker, animations } = mountTicker();
  let renderer;
  await act(async () => { renderer = create(React.createElement(NumberTicker, { value: 1 })); });
  await act(async () => { renderer.update(React.createElement(NumberTicker, { value: 8 })); });
  await act(async () => { renderer.update(React.createElement(NumberTicker, { value: 2 })); });
  assert.equal(animations.length, 2);
  assert.equal(animations[0].stopped, true);
  assert.equal(animations[1].config.toValue, -2 * 21);
  await act(async () => renderer.unmount());
});
