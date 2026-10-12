import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiOkResponse, ApiOperation, ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';

const yaml = require('js-yaml') as {
  dump(value: unknown, options?: Record<string, unknown>): string;
  load(value: string, options?: Record<string, unknown>): unknown;
  CORE_SCHEMA: unknown;
  JSON_SCHEMA: unknown;
  YAML11_SCHEMA: unknown;
};

class SerializationFixture {
  identifier!: string;
  total!: number;
  labels!: string[];
}
ApiProperty({ type: String, example: '01', description: 'Сохранить строку: номер заказа' })(SerializationFixture.prototype, 'identifier');
ApiProperty({ type: Number, minimum: 0, example: 230.5 })(SerializationFixture.prototype, 'total');
ApiProperty({ type: [String], example: ['null', 'true', '2026-10-13', 'Ресторан'] })(SerializationFixture.prototype, 'labels');

class SerializationController {
  value() { return { identifier: '01', total: 230.5, labels: ['Ресторан'] }; }
}
Controller('serialization-fixture')(SerializationController);
const descriptor = Object.getOwnPropertyDescriptor(SerializationController.prototype, 'value')!;
Reflect.defineMetadata('design:paramtypes', [], SerializationController.prototype, 'value');
Get()(SerializationController.prototype, 'value', descriptor);
ApiOperation({ summary: 'Synthetic YAML compatibility fixture' })(SerializationController.prototype, 'value', descriptor);
ApiOkResponse({ type: SerializationFixture })(SerializationController.prototype, 'value', descriptor);

class SerializationModule {}
Module({ controllers: [SerializationController] })(SerializationModule);

test('Swagger JSON and YAML preserve the same nested DTO document', async () => {
  const app = await NestFactory.create(SerializationModule, { logger: false });
  try {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Synthetic: schema').setVersion('01').build());
    SwaggerModule.setup('docs', app, document);
    await app.listen(0, '127.0.0.1');
    const json = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const serialized = await request(app.getHttpServer()).get('/docs-yaml').expect(200);
    assert.deepEqual(yaml.load(serialized.text), json.body);
    assert.equal(json.body.info.version, '01');
    assert.equal(json.body.components.schemas.SerializationFixture.properties.total.minimum, 0);
    assert.deepEqual(json.body.components.schemas.SerializationFixture.properties.labels.example, ['null', 'true', '2026-10-13', 'Ресторан']);
    assert.ok(json.body.paths['/serialization-fixture']);
  } finally { await app.close(); }
});

test('YAML dump/load and explicit schemas preserve JSON-like configuration values', () => {
  const value = { identifier: '01', date: '2026-10-13', empty: null, enabled: true, unicode: 'Ресторан: меню', choices: ['true', 'null', '01'], nested: { price: 230.5, minimum: 0 } };
  assert.deepEqual(yaml.load(yaml.dump(value, { noRefs: true, skipInvalid: true })), value);
  assert.deepEqual(yaml.load('enabled: true\nidentifier: "01"\nempty: null\n', { schema: yaml.JSON_SCHEMA }), { enabled: true, identifier: '01', empty: null });
  assert.deepEqual(yaml.load('value: 1\n', { schema: yaml.CORE_SCHEMA }), { value: 1 });
});

test('empty YAML merge sources consume the configured work budget', () => {
  assert.throws(() => yaml.load('arr: &arr [{}, {}, {}]\ntarget:\n  <<: *arr\n', { schema: yaml.YAML11_SCHEMA, maxTotalMergeKeys: 2 }), /merge|limit/i);
});
