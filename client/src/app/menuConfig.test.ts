import assert from 'node:assert/strict';
import test from 'node:test';

import { getAppMenuItems } from './menuConfig';

function flattenMenuItems() {
  return getAppMenuItems(false).flatMap((item) => [item, ...(item.children ?? [])]);
}

test('资源下载模块不再出现在主菜单或子菜单中', () => {
  const ids = flattenMenuItems().map((item) => item.id) as string[];
  assert.equal(ids.includes('resources'), false);
});

test('商务入口提供响应清单且不再显示计算器占位', () => {
  const businessBid = flattenMenuItems().find((item) => item.id === 'business-bid');

  assert.ok(businessBid);
  assert.equal(businessBid.label, '商务响应');
  assert.match(businessBid.description, /原件包/);
  assert.equal(businessBid.notice, undefined);
});
