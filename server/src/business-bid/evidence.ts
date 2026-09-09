import { Prisma } from '@prisma/client';
import { ApiError } from '../security/access';
import { businessDate, decimalAmount, evaluateValidity, parseDate } from '../ledger/validation';
import type { BusinessSource } from './sources';
export interface Evidence { field: string; label: string; expected: string; actual: string; state: 'met' | 'failed' | 'unknown'; reason?: string }
const levels: Record<string, number> = { '特级': 4, '一级': 3, '二级': 2, '三级': 1, '甲级': 3, '乙级': 2, '丙级': 1 };
export function validateThresholds(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!['category', 'certificateNo', 'minimumLevel', 'minimumAmount', 'currency', 'completedAfter', 'completedBefore', 'requiredRole', 'projectType'].includes(key)) throw new ApiError(400, '要求条件不受支持');
    if (value === '' || value === null || value === undefined) continue;
    if (typeof value !== 'string') throw new ApiError(400, '要求条件必须为文字，金额使用十进制字符串');
    if (key === 'minimumAmount') decimalAmount(value);
    if (['completedAfter', 'completedBefore'].includes(key)) parseDate(value, '业绩时间');
    result[key] = value.trim();
  }
  return result;
}
export function evaluateCandidate(source: BusinessSource, thresholds: Record<string, string>, date: string | Date | null): Evidence[] {
  const result: Evidence[] = [];
  const add = (field: string, label: string, expected: string, actual: unknown, state: Evidence['state'], reason?: string) => result.push({ field, label, expected, actual: actual == null || actual === '' ? '未知' : String(actual), state, reason });
  add('referenceDate', '核验日期', '已设置投标截止日期', businessDate(date), date ? 'met' : 'unknown');
  add('permission', '引用许可', '允许对外引用', source.allowed ? '允许' : source.issues.join('；'), source.allowed ? 'met' : 'failed');
  const proofCount = source.files.filter((file) => file.ownerType !== 'document-asset').length;
  add('files', '证明原件', '至少一份原件', proofCount, proofCount ? 'met' : 'unknown');
  const fields = source.data.fields;
  if (source.type !== 'performance') {
    const validity = evaluateValidity(fields, date); add('validity', '证照有效期', '投标截止日有效', fields.expiryDate ? businessDate(fields.expiryDate) : fields.validityKind, validity.state, validity.reason);
  }
  for (const [key, expected] of Object.entries(thresholds)) {
    if (['category', 'certificateNo', 'projectType', 'currency'].includes(key)) { const actual = fields[key]; add(key, { category: '证照类别', certificateNo: '证号', projectType: '项目类型', currency: '币种' }[key]!, expected, actual, !actual ? 'unknown' : actual === expected ? 'met' : 'failed'); }
    if (key === 'minimumLevel') { const actual = fields.qualificationLevel; const comparable = actual && levels[actual] && levels[expected] && /[甲乙丙]/.test(actual) === /[甲乙丙]/.test(expected); add(key, '最低等级', expected, actual, actual === expected ? 'met' : comparable ? levels[actual] >= levels[expected] ? 'met' : 'failed' : 'unknown'); }
    if (key === 'minimumAmount') {
      const actual = fields.contractAmount; const sameCurrency = fields.currency === (thresholds.currency || 'CNY');
      add(key, '最低合同金额（元）', expected, actual, actual == null ? 'unknown' : !sameCurrency ? 'failed' : new Prisma.Decimal(actual).gte(new Prisma.Decimal(expected)) ? 'met' : 'failed', sameCurrency ? undefined : '币种不同，不自动折算');
    }
    if (key === 'completedAfter' || key === 'completedBefore') { const actual = businessDate(fields.completedAt); add(key, key === 'completedAfter' ? '完成日期不早于' : '完成日期不晚于', expected, actual, !actual ? 'unknown' : (key === 'completedAfter' ? actual >= expected : actual <= expected) ? 'met' : 'failed'); }
    if (key === 'requiredRole') { const roles = (source.data.team || []).map((member: any) => member.role).filter(Boolean); add(key, '项目岗位', expected, roles.join('、'), !roles.length ? 'unknown' : roles.includes(expected) ? 'met' : 'failed'); }
  }
  return result;
}
