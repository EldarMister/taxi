const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../App.tsx'), 'utf8');
const syntax = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
function find(predicate) { let result; function visit(node) { if (result) return; if (predicate(node)) result = node; else ts.forEachChild(node, visit); } visit(syntax); assert.ok(result); return result; }
function jsxProp(component, name) {
  const element = find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(syntax) === component);
  return element.attributes.properties.find(prop => prop.name?.getText(syntax) === name).initializer.expression;
}
function expression(node, context) {
  const compiled = ts.transpileModule(`globalResult = (${node.getText(syntax)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInContext(compiled, context); return context.globalResult;
}

test('home address uses one field and returns from map selection to the hub without changing the trip destination', async () => {
  const pickup = { address: 'Старый адрес', latitude: 42.87, longitude: 74.57 }, destination = { address: 'Пункт поездки', latitude: 42.9, longitude: 74.6 };
  const jobs = [];
  const context = vm.createContext({ currentAddressEditing: false, savedPlaceEditing: null, addressField: null, service: 'hub', pickup, dropoff: destination, savedPlaces: {}, savedPlaceTitles: {}, mapField: null,
    savedPlaceMapTransition: { current: false }, savedPlacePickupRequest: { current: 0 }, normalizePoint: value => value, setError() {}, setLocatingSavedPlacePickup() {}, markManualPickup() {}, setRideDetails() {}, setRecenter() {}, setMapFocus() {},
    resolvePoint: async value => value, run: work => { const job = work(); jobs.push(job); return job; } });
  for (const name of ['SavedPlaceEditing', 'CurrentAddressEditing', 'AddressField', 'MapField', 'Service', 'Pickup', 'Dropoff']) context[`set${name}`] = value => { context[name.charAt(0).toLowerCase() + name.slice(1)] = value; };
  expression(jsxProp('FoodExperience', 'onChangeAddress'), context)();
  assert.equal(context.currentAddressEditing, true); assert.equal(context.addressField, 'pickup');
  const props = expression(jsxProp('AddressPicker', 'savedPlace'), context);
  assert.equal(props.title, 'Ваш адрес'); assert.equal(props.point, pickup);
  expression(jsxProp('AddressPicker', 'onMap'), context)();
  expression(jsxProp('AddressPicker', 'onClose'), context)();
  assert.equal(context.mapField, 'pickup'); assert.equal(context.currentAddressEditing, true); assert.equal(context.service, 'taxi');
  context.mapSelection = context.mapField;
  context.selectAddress = expression(find(node => ts.isVariableDeclaration(node) && node.name.getText(syntax) === 'selectAddress').initializer, context);
  const chooseMap = expression(find(node => ts.isVariableDeclaration(node) && node.name.getText(syntax) === 'mapSelect').initializer, context);
  const selected = { address: 'Новый адрес', latitude: 42.91, longitude: 74.61 };
  chooseMap(selected); await Promise.all(jobs);
  assert.deepEqual({ ...context.pickup }, selected); assert.equal(context.dropoff, destination);
  assert.equal(context.currentAddressEditing, false); assert.equal(context.mapField, null); assert.equal(context.service, 'hub');
});
