import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from '../test/database';
import { createAssetLibraryStore } from '../asset-library/store';
import { createPersonnelStore } from '../personnel/store';
import { createPerformanceStore } from '../performance/store';
import { evaluateValidity, decimalAmount } from './validation';

test('ledger relations, decimal precision, validity boundaries, optimistic writes and source protection', async (t) => {
  const { prisma } = await testDatabase(t);
  const user = await prisma.user.create({ data: { username: 'ledger', password: 'synthetic', status: 'active', role: 'admin' } });
  const assets = createAssetLibraryStore(prisma); const personnel = createPersonnelStore(prisma); const performance = createPerformanceStore(prisma);
  const asset = await assets.createItem('company', { name: '合成资质', category: '施工资质', certificateNo: 'TEST-001', qualificationLevel: '一级', expiryDate: '2026-09-08', validityKind: 'dated' }, user.id);
  const unknown = await assets.createItem('company', { name: '未知有效期' }, user.id);
  assert.equal(unknown.validityKind, 'unknown');
  assert.equal(evaluateValidity(asset, '2026-09-08').state, 'met');
  assert.equal(evaluateValidity(asset, '2026-09-09').state, 'failed');
  assert.equal(evaluateValidity(asset, null).state, 'unknown');
  assert.equal(evaluateValidity(unknown, '2026-09-08').state, 'unknown');
  assert.throws(() => decimalAmount(9007199254740993));
  assert.equal(decimalAmount('9007199254740993.21')!.toFixed(2), '9007199254740993.21');
  const person = await personnel.createProfile({ name: '合成人员' }, user.id);
  const cert1 = await personnel.addCertificate(person.id, { certName: '执业证', certificateNo: 'PERSON-001', validityKind: 'permanent' }, user.id);
  await personnel.addCertificate(person.id, { certName: '职称证', validityKind: 'unknown' }, user.id);
  assert.equal((await personnel.getProfile(person.id))!.certificates.length, 2);
  const record = await performance.create({ title: '合成业绩', contractAmount: '9007199254740993.21', assetIds: [asset.id], team: [{ profileId: person.id, role: '项目经理' }] }, user.id);
  assert.equal(record.contractAmount, '9007199254740993.21'); assert.equal(record.isPubliclyCitable, false);
  await assert.rejects(performance.update(record.id, { version: record.version, knowledgeItems: [{ documentId: 'missing', itemId: 'missing' }] }, user.id), /已关联/);
  const updated = await Promise.allSettled([
    assets.updateItem('company', asset.id, { version: asset.version, notes: '甲编辑' }, user.id),
    assets.updateItem('company', asset.id, { version: asset.version, notes: '乙编辑' }, user.id),
  ]);
  assert.equal(updated.filter((r) => r.status === 'fulfilled').length, 1);
  const current = (await assets.getItem('company', asset.id))!;
  await assert.rejects(assets.deleteItem('company', asset.id, current.version, user.id, true), /仍被业绩档案引用/);
  await assert.rejects(personnel.deleteProfile(person.id, person.version, user.id, true), /仍被业绩档案引用/);
  await assert.rejects(assets.createItem('personnel', { name: '禁止旧写入口' }, user.id), /仅可读取/);
  const publicRecord = await performance.update(record.id, { version: record.version, isPubliclyCitable: true }, user.id);
  await performance.update(record.id, { version: publicRecord.version, isPubliclyCitable: false }, user.id);
  assert.equal(await prisma.referenceRevocation.count({ where: { sourceId: record.id } }), 1);
  await personnel.deleteCertificate(person.id, cert1.id, cert1.version, user.id);
  assert.ok((await prisma.personnelCertificate.findUniqueOrThrow({ where: { id: cert1.id } })).archivedAt);
  assert.equal((await personnel.getProfile(person.id))!.certificates.length, 1);
});
