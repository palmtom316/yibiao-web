import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { userRoutes } from './users';
import { createVerifyToken, createRequireAdmin, signToken } from '../auth/middleware';

type UserRow = { id: number; username: string; displayName: string | null; phone: string | null; department: string | null; role: string; status: string; modules: string; createdAt: Date };

test('R04 last active admin cannot demote, disable or delete themselves out of existence', async (t) => {
  const users = new Map<number, UserRow>([
    [1, { id: 1, username: 'admin', displayName: '管理员', phone: null, department: null, role: 'admin', status: 'active', modules: '[]', createdAt: new Date() }],
    [2, { id: 2, username: 'alice', displayName: 'Alice', phone: null, department: null, role: 'user', status: 'active', modules: '[]', createdAt: new Date() }],
  ]);
  let locked = 0;
  const prisma: any = {
    user: {
      findUnique: async ({ where: { id } }: any) => users.get(id) || null,
      findMany: async () => [...users.values()],
      count: async ({ where }: any = {}) => [...users.values()].filter((row) => {
        if (where?.status && row.status !== where.status) return false;
        if (where?.role && row.role !== where.role) return false;
        if (where?.id?.not != null && row.id === where.id.not) return false;
        if (where?.NOT?.id != null && row.id === where.NOT.id) return false;
        return true;
      }).length,
      update: async ({ where: { id }, data }: any) => {
        const row = users.get(id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where: { id } }: any) => {
        const row = users.get(id);
        users.delete(id);
        return row;
      },
    },
    $transaction: async (fn: any) => fn(prisma),
    $queryRaw: async () => { locked += 1; return [...users.values()].filter((row) => row.role === 'admin' && row.status === 'active'); },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorate('prisma', prisma);
  app.addHook('onRequest', createVerifyToken(prisma));
  app.addHook('onRequest', createRequireAdmin());
  await app.register(userRoutes);
  const headers = { authorization: `Bearer ${signToken({ id: 1, username: 'admin', role: 'admin' })}` };

  const demote = await app.inject({ method: 'PUT', url: '/users/1', headers, payload: { role: 'user' } });
  assert.equal(demote.statusCode, 409);
  assert.match(demote.json().error, /至少保留一名可用管理员/);
  assert.equal(users.get(1)!.role, 'admin');

  const disableOtherAdminMissing = await app.inject({ method: 'POST', url: '/users/1/disable', headers, payload: {} });
  assert.equal(disableOtherAdminMissing.statusCode, 400, 'self-disable remains independently rejected');

  users.set(3, { id: 3, username: 'other-admin', displayName: 'Other', phone: null, department: null, role: 'admin', status: 'active', modules: '[]', createdAt: new Date() });
  const disableLastOther = await app.inject({ method: 'POST', url: '/users/3/disable', headers });
  assert.equal(disableLastOther.statusCode, 200);
  users.get(3)!.status = 'disabled';
  users.get(3)!.role = 'admin';
  const deleteLastRemainingPeer = await app.inject({ method: 'DELETE', url: '/users/2', headers });
  assert.equal(deleteLastRemainingPeer.statusCode, 200);
  const demoteAfterPeerGone = await app.inject({ method: 'PUT', url: '/users/1', headers, payload: { role: 'user' } });
  assert.equal(demoteAfterPeerGone.statusCode, 409);
  assert.ok(locked >= 1);
});
