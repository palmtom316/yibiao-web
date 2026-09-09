import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import type { AgentPendingQuestion } from '../../../shared/api/agent';

interface AgentQuestionDialogProps {
  question: AgentPendingQuestion | null;
  submitting?: boolean;
  onSubmit: (optionId: string, customAnswer?: string, answerPayload?: unknown) => void;
  onDefer: () => void;
}

function getMetadataRecord(question: AgentPendingQuestion | null): Record<string, unknown> {
  return question?.metadata && typeof question.metadata === 'object' && !Array.isArray(question.metadata)
    ? question.metadata as Record<string, unknown>
    : {};
}

function getRecommendedOptionId(question: AgentPendingQuestion | null): string {
  const recommended = question?.options.find((option) => option.recommended);
  return recommended?.id || question?.options[0]?.id || '';
}

function formatQuestionItems(question: AgentPendingQuestion | null): string[] {
  const metadata = getMetadataRecord(question);
  const items = Array.isArray(metadata.items) ? metadata.items : [];
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const title = (item as Record<string, unknown>).title;
        return typeof title === 'string' ? title.trim() : '';
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, 9);
}

function AgentQuestionDialog({ question, submitting = false, onSubmit, onDefer }: AgentQuestionDialogProps) {
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const [customAnswer, setCustomAnswer] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const metadata = useMemo(() => getMetadataRecord(question), [question]);
  const itemTitles = useMemo(() => formatQuestionItems(question), [question]);
  const recommendedOptionId = useMemo(() => getRecommendedOptionId(question), [question]);

  useEffect(() => {
    setSelectedOptionId(getRecommendedOptionId(question));
    setCustomAnswer('');
    const items = getMetadataRecord(question).items;
    setSelectedIds(Array.isArray(items) ? items.map((item) => String(item.id || '')).filter(Boolean) : []);
  }, [question?.question_id]);

  if (!question) return null;

  const title = typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title.trim() : '目录策略';
  const itemCount = typeof metadata.item_count === 'number' ? metadata.item_count : itemTitles.length;
  const selectedOption = question.options.find((option) => option.id === selectedOptionId);
  const selectedIsDefer = selectedOption?.id === 'defer';
  const isRootSelection = metadata.kind === 'outline-v2-selection';
  const roots = (Array.isArray(metadata.items) ? metadata.items : []) as { id: string; title: string; description?: string }[];
  const confirmDisabled = submitting || !selectedOptionId || Boolean(selectedOption?.custom && !customAnswer.trim()) || (isRootSelection && !selectedIds.length && !selectedIsDefer);

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="content-regenerate-modal" />
        <Dialog.Content className="agent-question-card">
          <div className="agent-question-head">
            <Dialog.Title>需要您确认以下问题</Dialog.Title>
            <Dialog.Description>
              {question.task_title || '提交后，后台 Agent 会继续执行当前任务。'}
            </Dialog.Description>
          </div>

          <section className="agent-question-summary">
            <p>{question.question}</p>
            {itemTitles.length > 0 && !isRootSelection && (
              <div className="agent-question-detected-items">
                <strong>检测到“{title}”章节要求 · {itemCount} 项</strong>
                <span>{itemTitles.join('、')}</span>
              </div>
            )}
          </section>

          {isRootSelection && <div className="agent-question-roots" role="group" aria-label="保留的一级目录">
            {roots.map((root) => <label key={root.id}>
              <input type="checkbox" checked={selectedIds.includes(root.id)} disabled={submitting}
                onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, root.id] : ids.filter((id) => id !== root.id))} />
              <span><strong>{root.id}. {root.title}</strong><small>{root.description}</small></span>
            </label>)}
          </div>}

          <div className="agent-question-options" role="radiogroup" aria-label="确认选项">
            {question.options.map((option) => {
              const optionId = option.id || option.label;
              const active = selectedOptionId === optionId;
              return (
                <button
                  type="button"
                  key={optionId}
                  className={`agent-question-option${active ? ' is-active' : ''}`}
                  onClick={() => setSelectedOptionId(optionId)}
                  role="radio"
                  aria-checked={active}
                  disabled={submitting}
                >
                  <span className="agent-question-radio" aria-hidden="true" />
                  <span className="agent-question-option-copy">
                    <strong>
                      {option.label}
                      {(option.recommended || optionId === recommendedOptionId) && <em>推荐</em>}
                    </strong>
                    {option.description && <small>{option.description}</small>}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedOption?.custom && <label className="agent-question-custom">具体要求
            <textarea value={customAnswer} onChange={(event) => setCustomAnswer(event.target.value)} maxLength={10000} rows={4} disabled={submitting} />
          </label>}

          <div className="agent-question-actions">
            <span className="agent-question-manual-note">请人工确认后继续，确保本项目目录策略准确。</span>
            <div className="agent-question-action-buttons">
              {question.options.some((option) => option.id === 'defer') && <button type="button" className="secondary-action" onClick={onDefer} disabled={submitting}>
                稍后处理
              </button>}
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  if (selectedIsDefer) {
                    onDefer();
                  } else if (selectedOptionId) {
                    onSubmit(selectedOptionId, customAnswer.trim() || undefined, isRootSelection ? { selectedIds } : undefined);
                  }
                }}
                disabled={confirmDisabled}
              >
                {submitting ? '正在提交...' : '确定并继续'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default AgentQuestionDialog;
