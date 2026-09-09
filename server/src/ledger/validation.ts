import { Prisma } from '@prisma/client';
import { ApiError } from '../security/access';
export type ValidityKind = 'dated' | 'permanent' | 'unknown';
export interface LedgerFields {
  category?: string | null; certificateNo?: string | null; qualificationLevel?: string | null; holderName?: string | null; issuer?: string | null;
  validFrom?: string | null; validityKind?: ValidityKind; version?: number; archivedAt?: string | null; createdByUserId?: number | null; updatedByUserId?: number | null;
}
export function businessDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function parseDate(value: unknown, field: string): Date | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new ApiError(400, `${field}必须是有效业务日期`);
  return new Date(`${value}T00:00:00.000Z`);
}
export function decimalAmount(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{1,18}(\.\d{1,2})?$/.test(value)) throw new ApiError(400, '金额须为非负十进制字符串，最多两位小数，单位元');
  return new Prisma.Decimal(value);
}
export function expectedVersion(value: unknown): number {
  const version = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new ApiError(409, '请刷新资料后携带当前版本保存');
  return version;
}
export function normalizeLedger(input: Record<string, any>, current?: Record<string, any>) {
  const data: Record<string, any> = {};
  for (const key of ['category', 'certificateNo', 'qualificationLevel', 'holderName', 'issuer']) {
    if (input[key] !== undefined) { if (input[key] !== null && typeof input[key] !== 'string') throw new ApiError(400, '台账字段必须为文字'); data[key] = input[key]?.trim().slice(0, 200) || null; }
  }
  if (input.validFrom !== undefined) data.validFrom = parseDate(input.validFrom, '生效日期');
  if (input.expiryDate !== undefined) data.expiryDate = parseDate(input.expiryDate, '到期日期');
  const expiry = data.expiryDate !== undefined ? data.expiryDate : current?.expiryDate;
  const kind = input.validityKind ?? current?.validityKind ?? (expiry ? 'dated' : 'unknown');
  if (!['dated', 'permanent', 'unknown'].includes(kind)) throw new ApiError(400, '有效期类型无效');
  if (kind === 'dated' && !expiry) throw new ApiError(400, '有期限证照必须填写到期日');
  if (kind === 'permanent' && expiry) throw new ApiError(400, '永久有效证照应清空到期日');
  const from = data.validFrom !== undefined ? data.validFrom : current?.validFrom;
  if (from && expiry && from > new Date(expiry)) throw new ApiError(400, '生效日期不得晚于到期日');
  data.validityKind = kind;
  return data;
}
export function evaluateValidity(record: { validityKind?: string; validFrom?: Date | string | null; expiryDate?: Date | string | null }, referenceDate?: string | Date | null) {
  const date = businessDate(referenceDate);
  if (!date) return { state: 'unknown' as const, reason: '未设置投标截止核验日期' };
  const start = businessDate(record.validFrom);
  if (start && start > date) return { state: 'failed' as const, reason: '核验日尚未生效' };
  if (record.validityKind === 'permanent') return { state: 'met' as const, reason: '已登记永久有效' };
  const expiry = businessDate(record.expiryDate);
  if (record.validityKind !== 'dated' || !expiry) return { state: 'unknown' as const, reason: '有效期资料不足，待核验' };
  return expiry < date ? { state: 'failed' as const, reason: '投标截止日已过期' } : { state: 'met' as const, reason: '截止日有效（到期当日有效）' };
}
