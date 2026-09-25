const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const moduleCache = new Map();
const secureValues = new Map();
const secureStore = {
  getItemAsync: async key => secureValues.get(key) ?? null,
  setItemAsync: async (key, value) => {
    assert.match(key, /^[\w.-]+$/, `SecureStore key must be valid: ${key}`);
    assert.ok(Buffer.byteLength(value, 'utf8') <= 2048, `SecureStore value exceeds 2048 bytes: ${Buffer.byteLength(value, 'utf8')}`);
    secureValues.set(key, value);
  },
  deleteItemAsync: async key => { secureValues.delete(key); },
};
function loadTs(relative) {
  const filename = path.join(__dirname, '..', relative);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  moduleCache.set(filename, module);
  const localRequire = request => {
    if (request === 'expo-secure-store') return secureStore;
    if (request.startsWith('.')) {
      const target = path.resolve(path.dirname(filename), request.endsWith('.ts') ? request : `${request}.ts`);
      if (fs.existsSync(target)) return loadTs(path.relative(path.join(__dirname, '..'), target));
    }
    return require(request);
  };
  Function('exports', 'module', 'require', '__filename', '__dirname', output)(module.exports, module, localRequire, filename, path.dirname(filename));
  return module.exports;
}

const types = loadTs('src/registration/types.ts');
const flow = loadTs('src/registration/flow.ts');
const attention = loadTs('src/registration/attention.ts');
const storage = loadTs('src/registration/storage.ts');
const config = {
  minimumAge: 18, countries: [], cities: [], districts: {}, driverLicenseCategories: ['B'], cargoVehicleTypes: [], taxiBodyTypes: [], tariffs: [], payoutMethods: [], documents: [], legalTermsVersion: '1',
};

const app = (roles, modes = []) => {
  const value = types.emptyRegistrationApplication('ru');
  value.roles = roles;
  value.data.courier.transportModes = modes;
  return value;
};
const ids = value => flow.buildRegistrationSteps(value).map(step => step.id);

test('лёгкие курьеры проходят регистрацию только с ID-картой', () => {
  for (const mode of ['FOOT', 'BICYCLE', 'E_BICYCLE', 'SCOOTER']) {
    const value = app(['COURIER'], [mode]);
    Object.assign(value.data.personal, { firstName: 'Асан', lastName: 'Ибраев', birthDate: '10.03.1990', city: 'Бишкек' });
    value.data.identity.expiresAt = '01.01.2035';
    for (const slotKey of ['identity_front', 'identity_back']) value.data.uploads[slotKey] = { slotKey, kind: 'IDENTITY_DOCUMENT', status: 'UPLOADED' };
    value.data.agreements.truthConfirmed = true;
    value.data.agreements.termsAccepted = true;
    assert.deepEqual(ids(value), ['ROLES', 'COURIER_TRANSPORT', 'PERSONAL_DATA', 'IDENTITY_DOCUMENT', 'REVIEW'], mode);
    for (const step of ids(value)) assert.deepEqual(flow.validateRegistrationStep(step, value, config).errors, {}, `${mode}: ${step}`);
  }
});

test('клиент и сервер согласованы для всех направлений и способов доставки', () => {
  const server = loadTs('../server/src/registration-domain.ts');
  for (const roles of [['COURIER'], ['TAXI_DRIVER'], ['CARGO_DRIVER'], ['COURIER', 'TAXI_DRIVER'], ['COURIER', 'CARGO_DRIVER']]) {
    for (const modes of [['FOOT'], ['BICYCLE'], ['E_BICYCLE'], ['SCOOTER'], ['MOPED'], ['MOTORCYCLE'], ['CAR'], ['TRUCK'], ['SCOOTER', 'CAR']]) {
      const value = app(roles, modes);
      const context = `${roles}: ${modes}`;
      const steps = flow.buildRegistrationSteps(value, server.REGISTRATION_CONFIG);
      assert.deepEqual(steps.map(step => step.id), server.registrationSteps(roles, value.data), context);
      const slots = steps.flatMap(step => flow.registrationUploadSlotsForStep(step.id, value, server.REGISTRATION_CONFIG)).filter(slot => slot.required).map(slot => slot.slotKey);
      assert.deepEqual(slots.sort(), server.requiredUploadSlots(roles, value.data).sort(), context);
    }
  }
});

test('пеший курьер не получает шаги прав и транспорта', () => {
  const steps = ids(app(['COURIER'], ['FOOT']));
  assert.ok(steps.includes('COURIER_TRANSPORT'));
  assert.ok(!steps.includes('COURIER_SETTINGS'));
  assert.ok(!steps.includes('DRIVER_LICENSE'));
  assert.ok(!steps.includes('COURIER_VEHICLE'));
});

test('моторный курьер получает общие права и одну карточку транспорта', () => {
  const steps = ids(app(['COURIER'], ['MOTORCYCLE']));
  assert.ok(steps.includes('DRIVER_LICENSE'));
  assert.ok(steps.includes('COURIER_VEHICLE'));
  assert.ok(!steps.includes('TAXI_VEHICLE'));
});

test('такси и курьер переиспользуют права и автомобиль', () => {
  const value = app(['TAXI_DRIVER', 'COURIER'], ['CAR']);
  value.data.courier.useExistingVehicle = true;
  value.data.courier.existingVehicleUsage = 'TAXI';
  const steps = ids(value);
  assert.equal(steps.filter(step => step === 'DRIVER_LICENSE').length, 1);
  assert.ok(steps.includes('TAXI_VEHICLE'));
  assert.ok(!steps.includes('COURIER_VEHICLE'));
});

test('курьер может добавить другой автомобиль рядом с автомобилем такси', () => {
  const steps = ids(app(['TAXI_DRIVER', 'COURIER'], ['CAR']));
  assert.ok(steps.includes('TAXI_VEHICLE'));
  assert.ok(steps.includes('COURIER_VEHICLE'));
});

test('такси и грузовой водитель имеют независимые транспортные ветки', () => {
  const steps = ids(app(['TAXI_DRIVER', 'CARGO_DRIVER']));
  for (const step of ['TAXI_VEHICLE', 'TAXI_DOCUMENTS', 'TAXI_PHOTOS', 'CARGO_VEHICLE', 'CARGO_DOCUMENTS', 'CARGO_PHOTOS']) assert.ok(steps.includes(step), step);
  assert.ok(!steps.includes('CARGO_EQUIPMENT'));
  assert.equal(steps.filter(step => step === 'DRIVER_LICENSE').length, 1);
});

test('моторный транспорт курьера требует документы и фотографию', () => {
  const value = app(['COURIER'], ['CAR']);
  Object.assign(value.data.courierVehicle, { ownership: 'OWN', brand: 'Toyota', model: 'Prius', year: '2020', plateNumber: '01 777 AAA' });
  const result = flow.validateRegistrationStep('COURIER_VEHICLE', value, config);
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ['courier_insurance', 'courier_photo', 'courier_registration', 'expiry_courier_insurance']);
});

test('прогресс пересчитывается после снятия роли без удаления данных', () => {
  const value = app(['TAXI_DRIVER', 'CARGO_DRIVER']);
  value.data.cargoVehicle.brand = 'Mercedes';
  const before = ids(value);
  value.roles = ['TAXI_DRIVER'];
  const after = ids(value);
  assert.ok(before.length > after.length);
  assert.ok(!after.includes('CARGO_VEHICLE'));
  assert.equal(value.data.cargoVehicle.brand, 'Mercedes');
});

test('выплаты проверяются отдельно и не добавляют шаг регистрации', () => {
  const value = app(['COURIER'], ['FOOT']);
  Object.assign(value.data.personal, { firstName: 'Асан', lastName: 'Ибраев', birthDate: '10.03.1990', city: 'Бишкек' });
  Object.assign(value.data.identity, { number: 'ID-1', issuedAt: '01.01.2020', expiresAt: '01.01.2030', issuedBy: 'МКК' });
  Object.assign(value.data.courier, { orderTypes: ['DOCUMENTS'], maxWeightKg: '5', city: 'Бишкек' });
  for (const slotKey of ['profile_photo', 'identity_front', 'identity_back']) value.data.uploads[slotKey] = { slotKey, kind: 'IDENTITY_DOCUMENT', status: 'UPLOADED' };
  value.data.payment.type = 'CARD';
  value.data.payment.last4 = '45';
  assert.equal(flow.validateRegistrationStep('PAYMENT', value, config).valid, false);
  value.data.skippedSteps.push('PAYMENT');
  assert.equal(flow.firstIncompleteStep(value, config), 'REVIEW');
});

const fillVehicle = (vehicle, cargo = false) => Object.assign(vehicle, {
  ownership: 'OWN', brand: cargo ? 'Mercedes' : 'Toyota', model: cargo ? 'Actros' : 'Prius', year: '2022', plateNumber: cargo ? '01 222 BBB' : '01 111 AAA',
  ...(cargo ? { type: 'Фургон', capacityKg: '3500' } : {}),
});

test('дополнительная машина имеет стабильный clientId и отдельные слоты документов', () => {
  const value = app(['TAXI_DRIVER']);
  const extra = types.createAdditionalVehicle('TAXI', 'v-taxi1');
  fillVehicle(extra); extra.tariffs = ['ECONOMY']; extra.ownership = 'RENT';
  value.data.vehicles.push(extra);
  assert.deepEqual(flow.additionalVehicleUploadSlotsForStep('TAXI_DOCUMENTS', value).map(item => item.slotKey), [
    'vehicle_v-taxi1_registration', 'vehicle_v-taxi1_insurance', 'vehicle_v-taxi1_rental',
  ]);
  assert.deepEqual(flow.additionalVehicleUploadSlotsForStep('TAXI_PHOTOS', value).map(item => item.slotKey), [
    'vehicle_v-taxi1_photo_front',
  ]);
  const result = flow.validateRegistrationStep('TAXI_DOCUMENTS', value, config);
  assert.ok(result.errors['vehicle_v-taxi1_registration']);
  assert.ok(result.errors['vehicle_v-taxi1_insurance']);
  assert.ok(result.errors['expiry_vehicle_v-taxi1_insurance']);
  assert.ok(result.errors['vehicle_v-taxi1_rental']);
});

test('дополнительный грузовик валидирует собственную комплектацию', () => {
  const value = app(['CARGO_DRIVER']);
  const extra = types.createAdditionalVehicle('CARGO', 'v-cargo1');
  fillVehicle(extra, true);
  value.data.vehicles.push(extra);
  let result = flow.validateRegistrationStep('CARGO_EQUIPMENT', value, config);
  assert.equal(result.errors['vehicle_v-cargo1_loadingTypes'], 'Выберите тип загрузки');
  extra.equipment.loadingTypes = ['REAR'];
  extra.equipment.refrigerator = true;
  result = flow.validateRegistrationStep('CARGO_EQUIPMENT', value, config);
  assert.ok(result.errors['vehicle_v-cargo1_temperature']);
  Object.assign(extra.equipment, { minTemperature: '-10', maxTemperature: '5' });
  result = flow.validateRegistrationStep('CARGO_EQUIPMENT', value, config);
  assert.equal(result.errors['vehicle_v-cargo1_loadingTypes'], undefined);
  assert.equal(result.errors['vehicle_v-cargo1_temperature'], undefined);
});

test('дополнительный транспорт ограничен пятью карточками', () => {
  const value = app(['TAXI_DRIVER']);
  for (let index = 0; index < 6; index += 1) value.data.vehicles.push(types.createAdditionalVehicle('TAXI', `v-limit${index}`));
  const result = flow.validateRegistrationStep('TAXI_VEHICLE', value, config);
  assert.match(result.errors.vehicles, /не более 5/);
});

test('курьер выбирает конкретную основную или дополнительную машину', () => {
  const value = app(['TAXI_DRIVER', 'COURIER'], ['CAR']);
  const extra = types.createAdditionalVehicle('TAXI', 'v-reuse1');
  fillVehicle(extra); extra.tariffs = ['ECONOMY']; value.data.vehicles.push(extra);
  Object.assign(value.data.courier, { useExistingVehicle: true, existingVehicleUsage: 'TAXI', existingVehicleClientId: extra.clientId });
  assert.equal(flow.validateRegistrationStep('COURIER_TRANSPORT', value, config).errors.existingVehicleUsage, undefined);
  value.data.courier.existingVehicleClientId = 'v-missing';
  assert.equal(flow.validateRegistrationStep('COURIER_TRANSPORT', value, config).errors.existingVehicleUsage, 'Выбранная машина больше не доступна');
});

test('дополнительный транспорт курьера использует один снимок спереди', () => {
  const value = app(['COURIER'], ['CAR']);
  const extra = types.createAdditionalVehicle('COURIER', 'v-courier1');
  fillVehicle(extra); value.data.vehicles.push(extra);
  const slots = flow.additionalVehicleUploadSlotsForStep('COURIER_VEHICLE', value).map(item => item.slotKey);
  assert.deepEqual(slots, ['vehicle_v-courier1_registration', 'vehicle_v-courier1_insurance', 'vehicle_v-courier1_photo_front']);
});

test('срок исправленного документа остаётся редактируемым после успешной повторной загрузки', () => {
  const slot = 'vehicle_v-taxi1_insurance';
  const scope = [`uploads.${slot}`, `data.documentExpiries.${slot}`];
  assert.equal(flow.correctionExpiryAllowed(scope, slot), true);
  assert.equal(flow.correctionExpiryAllowed([`uploads.${slot}`], slot), false);
  assert.equal(flow.correctionExpiryAllowed(['data.documentExpiries'], slot), true);
  assert.equal(flow.correctionExpiryAllowed(undefined, slot), true);
});

test('в режиме исправления проблемный файл можно заменить, но нельзя удалить', () => {
  assert.equal(flow.correctionUploadDeleteAllowed(undefined), true);
  assert.equal(flow.correctionUploadDeleteAllowed([]), false);
  assert.equal(flow.correctionUploadDeleteAllowed(['uploads.vehicle_v-taxi1_insurance']), false);
});

test('холодный запуск замечает actionable статус, не блокируя другое рабочее направление', () => {
  assert.equal(attention.registrationAttentionFromResponse({ application: { status: 'APPROVED', roleStatuses: [{ status: 'APPROVED', operational: true }] } }), null);
  assert.deepEqual(attention.registrationAttentionFromResponse({ application: {
    status: 'CORRECTION_REQUIRED',
    roleStatuses: [{ status: 'APPROVED', operational: true }, { status: 'CORRECTION_REQUIRED', operational: false }],
  } }), { status: 'CORRECTION_REQUIRED', hasOperational: true, message: 'Документы требуют исправления' });
  assert.deepEqual(attention.registrationAttentionFromResponse({ application: {
    status: 'UNDER_REVIEW',
    roleStatuses: [{ status: 'APPROVED', operational: false }],
    uploads: [{ status: 'EXPIRED' }],
  } }), { status: 'CORRECTION_REQUIRED', hasOperational: false, message: 'Документы требуют исправления' });
});

test('блокировка имеет приоритет над параллельным исправлением', () => {
  assert.deepEqual(attention.registrationAttentionFromResponse({ application: {
    status: 'CORRECTION_REQUIRED',
    roleStatuses: [{ status: 'BLOCKED', operational: false }, { status: 'CORRECTION_REQUIRED', operational: false }],
  } }), { status: 'BLOCKED', hasOperational: false, message: 'Одно из направлений временно ограничено' });
});

test('регистрационные запросы не ломаются на пустом 304-ответе Android', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'api.ts'), 'utf8');
  assert.match(source, /cache:\s*'no-store'/);
  assert.match(source, /response\.status\s*===\s*304/);
  assert.match(source, /If-Modified-Since/);
  assert.doesNotMatch(source, /_fresh=\$\{Date\.now\(\)\}/);
});

test('недоступный Комфорт объясняется без ссылки на администратора', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'AccountScreens.tsx'), 'utf8');
  assert.match(source, /Недоступен вам/);
  assert.doesNotMatch(source, /Доступ назначает администратор/);
});

test('исправление дополнительной машины принимает canonical clientId и старый индекс', () => {
  const canonical = 'vehicles.v-taxi1.brand';
  assert.equal(flow.correctionVehicleFieldAllowed([canonical], 'v-taxi1', 2, canonical), true);
  assert.equal(flow.correctionVehicleFieldAllowed(['vehicles.2.brand'], 'v-taxi1', 2, canonical), true);
  assert.equal(flow.correctionVehicleFieldAllowed(['vehicles.v-other.brand'], 'v-taxi1', 2, canonical), false);
  assert.equal(flow.correctionVehicleFieldAllowed(['vehicles.v-taxi1.equipment'], 'v-taxi1', 2, 'vehicles.v-taxi1.equipment.loadingTypes'), true);
});

test('дата рождения выбирается системным календарём без ручного ввода', () => {
  const components = fs.readFileSync(path.join(__dirname, '..', 'src', 'registration', 'components.tsx'), 'utf8');
  const steps = fs.readFileSync(path.join(__dirname, '..', 'src', 'registration', 'steps.tsx'), 'utf8');
  assert.match(components, /DateTimePickerAndroid\.open/);
  assert.match(components, /export function NativeDateInput/);
  assert.match(steps, /<NativeDateInput label="Дата рождения"/);
  assert.doesNotMatch(steps, /<FormInput label="Дата рождения"/);
});

test('регистрация показывает сегментированные шаги и новые состояния', () => {
  const components = fs.readFileSync(path.join(__dirname, '..', 'src', 'registration', 'components.tsx'), 'utf8');
  const steps = fs.readFileSync(path.join(__dirname, '..', 'src', 'registration', 'steps.tsx'), 'utf8');
  const screen = fs.readFileSync(path.join(__dirname, '..', 'src', 'DriverRegistrationScreen.tsx'), 'utf8');
  assert.match(components, /Array\.from\(\{ length: total \}/);
  assert.match(components, /profileUploadCard/);
  assert.match(components, /profile-avatar-3d\.png/);
  assert.match(steps, /roles-checklist-3d\.png/);
  assert.match(steps, /role-taxi-3d\.png/);
  assert.match(steps, /role-cargo-3d\.png/);
  assert.match(steps, /role-courier-3d\.png/);
  assert.match(screen, /Разрешите доступ к камере/);
  assert.match(screen, /camera-permission-3d\.png/);
  assert.match(screen, /Не удалось загрузить данные/);
  assert.match(screen, /load-error-3d\.png/);
});

test('уже разрешённая камера открывается без повторного запроса', () => {
  const screen = fs.readFileSync(path.join(__dirname, '..', 'src', 'DriverRegistrationScreen.tsx'), 'utf8');
  assert.match(screen, /Camera\.getCameraPermissionsAsync\(\)/);
  assert.match(screen, /if \(permission\.granted\) \{ setCameraRequest\(request\); return; \}/);
  assert.match(screen, /permissionRequestedFor\.current !== request\.slotKey/);
  assert.match(screen, /permission && !permission\.granted/);
});

test('локальный черновик использует допустимые ключи SecureStore и сохраняет русские данные', async () => {
  secureValues.clear();
  const value = types.emptyRegistrationApplication('ru');
  value.roles = ['TAXI_DRIVER'];
  value.data.personal.firstName = 'Александр'.repeat(900);
  value.data.uploads.profile_photo = { slotKey: 'profile_photo', kind: 'PROFILE_PHOTO', status: 'QUEUED', localUri: 'file:///photo.jpg' };
  await storage.writeRegistrationDraft('driver:id/with invalid chars', value);
  assert.ok([...secureValues.keys()].every(key => /^[\w.-]+$/.test(key)));
  assert.ok([...secureValues.values()].every(chunk => Buffer.byteLength(chunk, 'utf8') <= 2048));
  assert.deepEqual(await storage.readRegistrationDraft('driver:id/with invalid chars'), value);
});

test('разбиение черновика считает UTF-8 байты и не режет emoji', () => {
  const value = `${'Я'.repeat(1200)}${'🚕'.repeat(300)}`;
  const chunks = storage.splitSecureStoreValue(value);
  assert.equal(chunks.join(''), value);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => Buffer.byteLength(chunk, 'utf8') <= 1800));
});
