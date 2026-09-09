// Adapted from upstream edc9119b5fbe947a36f0c9883d86e7bb68a5908c,
// piTaskFailureTool.cjs. AGPL-3.0-only; Web cancels only the active task.
import type { PiTypeBuilder } from './piJsonValidationTool';
export function createPiTaskFailureTool(Type: PiTypeBuilder, report: (reason: string) => void) {
  return {
    name: 'report-failure', label: '说明无法继续的原因',
    description: '现有材料无法支持任务且继续只能编造时，说明需要补充的业务资料并停止；不得删除、清空输入文件。',
    parameters: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
    execute: async (_id: string, input: { reason: string }) => {
      const reason = String(input.reason || '').trim();
      if (!reason || reason.length > 1000) throw new Error('请用简短文字说明无法继续的业务原因');
      report(reason);
      return { content: [{ type: 'text', text: JSON.stringify({ reported: true, reason }) }], details: { reported: true } };
    },
  };
}
