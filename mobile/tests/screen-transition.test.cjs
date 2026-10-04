const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = fs.readFileSync(path.join(__dirname, '../src/food/ScreenTransition.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
} }).outputText;

function loadTransition(reducedMotion) {
  const animations = [];

  class AnimatedValue {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    interpolate(config) { return { value: this, config }; }
  }

  const native = {
    Animated: {
      View: 'AnimatedView',
      Value: AnimatedValue,
      timing: (value, config) => {
        let callback;
        const animation = {
          config,
          start: next => { callback = next; },
          stop() {},
          finish: () => {
            value.setValue(config.toValue);
            callback?.({ finished: true });
          },
        };
        animations.push(animation);
        return animation;
      },
    },
    Easing: { cubic: value => value, out: easing => easing },
    StyleSheet: { create: styles => styles, absoluteFillObject: { position: 'absolute' } },
    View: 'View',
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return native;
      if (id === '../design/motion') return { useMotionPreference: () => reducedMotion };
      if (id === '../design/tokens') return { motion: { enter: 280 } };
      throw new Error(`Unexpected dependency ${id}`);
    },
  }, { filename: 'ScreenTransition.tsx' });
  return { ScreenTransition: exports.ScreenTransition, animations };
}

function StatefulPage({ name, lifecycle }) {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    lifecycle.push(`mount:${name}`);
    return () => lifecycle.push(`unmount:${name}`);
  }, [lifecycle, name]);
  return React.createElement('Page', { name, count, increment: () => setCount(value => value + 1) });
}

test('restaurants stays mounted below the dish sheet and restores its state on close', async t => {
  const lifecycle = [];
  const { ScreenTransition, animations } = loadTransition(false);
  const screen = (routeKey, direction, name) => React.createElement(
    ScreenTransition,
    { routeKey, direction },
    React.createElement(StatefulPage, { name, lifecycle }),
  );
  let renderer;
  await act(async () => { renderer = create(screen('restaurants', 'forward', 'restaurants')); });
  t.after(async () => act(async () => renderer.unmount()));
  const page = name => renderer.root.findAllByType('Page').find(node => node.props.name === name);

  await act(async () => page('restaurants').props.increment());
  assert.equal(page('restaurants').props.count, 1);

  await act(async () => renderer.update(screen('dish:sushi-roll:philadelphia', 'forward', 'dish')));
  assert.ok(page('restaurants'), 'the restaurants page must remain mounted below its detail');
  assert.ok(page('dish'), 'the detail page must be mounted for the forward transition');
  const underlay = renderer.root.findAllByType('AnimatedView').find(node => node.findAllByType('Page').some(item => item.props.name === 'restaurants'));
  assert.equal(underlay.props.style.some(style => style?.display === 'none'), false, 'the catalog remains visible under the dish sheet');
  assert.equal(animations.length, 0, 'the dish sheet provides its own entrance animation');
  assert.equal(page('restaurants').props.count, 1, 'hidden catalog state must survive the forward transition');
  assert.equal(lifecycle.filter(event => event === 'mount:restaurants').length, 1);

  await act(async () => renderer.update(screen('restaurants', 'back', 'restaurants')));
  assert.equal(animations.length, 0);

  assert.equal(page('restaurants').props.count, 1, 'returning must reveal the original stateful instance');
  assert.equal(lifecycle.filter(event => event === 'mount:restaurants').length, 1);
  assert.equal(page('dish'), undefined, 'a nonpersistent detail must be removed after leaving');
  assert.equal(lifecycle.filter(event => event === 'unmount:dish').length, 1);
});

test('Reduce Motion removes a nonpersistent previous page without retaining a leaving layer', async t => {
  const lifecycle = [];
  const { ScreenTransition, animations } = loadTransition(true);
  const screen = (routeKey, name) => React.createElement(
    ScreenTransition,
    { routeKey, direction: 'forward' },
    React.createElement(StatefulPage, { name, lifecycle }),
  );
  let renderer;
  await act(async () => { renderer = create(screen('dish:sushi-roll:philadelphia', 'dish')); });
  t.after(async () => act(async () => renderer.unmount()));

  await act(async () => renderer.update(screen('cart', 'cart')));

  const pages = renderer.root.findAllByType('Page');
  assert.equal(animations.length, 0, 'Reduce Motion must not start a screen animation');
  assert.equal(pages.length, 1, 'the outgoing page must not remain as a hidden/leaving layer');
  assert.equal(pages[0].props.name, 'cart');
  assert.equal(lifecycle.filter(event => event === 'unmount:dish').length, 1);
});

test('opening the full-screen cart animates and returning restores the existing menu', async t => {
  const lifecycle = [];
  const { ScreenTransition, animations } = loadTransition(false);
  const screen = (routeKey, name) => React.createElement(ScreenTransition, { routeKey, direction: 'forward' },
    React.createElement(StatefulPage, { name, lifecycle }));
  let renderer;
  await act(async () => { renderer = create(screen('restaurant:sushi-roll', 'restaurant')); });
  t.after(async () => act(async () => renderer.unmount()));
  await act(async () => renderer.update(screen('cart', 'cart')));
  const underlay = renderer.root.findAllByType('AnimatedView').find(node => node.findAllByType('Page').some(page => page.props.name === 'restaurant'));
  assert.ok(underlay);
  assert.equal(underlay.props.style.some(style => style?.display === 'none'), false);
  assert.equal(animations.length, 1, 'the full-screen cart needs the normal screen entrance');
  assert.equal(animations[0].config.useNativeDriver, true);
  await act(async () => animations[0].finish());
  await act(async () => renderer.update(screen('restaurant:sushi-roll', 'restaurant')));
  assert.equal(animations.length, 2, 'returning to the menu also has a transition');
  await act(async () => animations[1].finish());
  assert.equal(lifecycle.filter(event => event === 'mount:restaurant').length, 1);
  assert.equal(lifecycle.filter(event => event === 'unmount:cart').length, 1);
});

test('a dish opened from the cart keeps the cart visible and restores its state', async t => {
  const lifecycle = [];
  const { ScreenTransition, animations } = loadTransition(false);
  const screen = (routeKey, name) => React.createElement(ScreenTransition, { routeKey, direction: 'forward' },
    React.createElement(StatefulPage, { name, lifecycle }));
  let renderer;
  await act(async () => { renderer = create(screen('cart', 'cart')); });
  t.after(async () => act(async () => renderer.unmount()));
  await act(async () => renderer.root.findByType('Page').props.increment());
  await act(async () => renderer.update(screen('dish:sushi-roll:philadelphia', 'dish')));
  const cartLayer = renderer.root.findAllByType('AnimatedView').find(node => node.findAllByType('Page').some(page => page.props.name === 'cart'));
  assert.ok(cartLayer, 'cart is retained under the dish sheet');
  assert.equal(cartLayer.props.style.some(style => style?.display === 'none'), false);
  assert.equal(animations.length, 0, 'only the dish sheet owns its animation');
  await act(async () => renderer.update(screen('cart', 'cart')));
  assert.equal(renderer.root.findByType('Page').props.count, 1);
  assert.equal(lifecycle.filter(event => event === 'mount:cart').length, 1);
});
