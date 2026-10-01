import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Radio } from '@/components/ui/radio';
import { Icon } from "@/components/icon/Icon";

import { cn } from '@/lib/utils';
import { isIMECompositionEvent } from '@/lib/ime';
import { copyTextToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui';
import type { FormRequest } from '@/types/form';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessions } from '@/sync/sync-context';
import * as sessionActions from '@/sync/session-actions';
import { useI18n } from '@/lib/i18n';
import { serializeFormAsJson, serializeFormAsMarkdown } from './legacyFormSerializers';
import { LEGACY_FORM_CUSTOM_TEXTAREA_MIN_HEIGHT, getLegacyFormCustomTextareaHeight } from './legacyFormTextareaSizing';
import {
  clearFormDraft,
  isFormHandled,
  isFormHandledByTool,
  loadFormDraft,
  markFormHandled,
  markFormHandledByTool,
  saveFormDraft,
} from './lib/formDraftPersistence';

interface LegacyFormCardProps {
  form: FormRequest;
  inline?: boolean;
  resolveRequestTarget?: () => Promise<FormRequestTarget>;
  submitStaleFormAnswer?: (answers: string[][], directory?: string) => Promise<void>;
}

type FormRequestTarget =
  | { kind?: 'pending'; requestId: string; directory?: string }
  | { kind: 'stale'; directory?: string };

type TabKey = string;
const SUMMARY_TAB = 'summary';

const describeFormError = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
};

interface CustomAnswerTextareaProps {
  value: string;
  placeholder: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

const CustomAnswerTextarea = React.memo(function CustomAnswerTextarea({
  value,
  placeholder,
  disabled,
  onValueChange,
  onKeyDown,
}: CustomAnswerTextareaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [localValue, setLocalValue] = React.useState(value);
  const [height, setHeight] = React.useState(LEGACY_FORM_CUSTOM_TEXTAREA_MIN_HEIGHT);
  const [isScrollable, setIsScrollable] = React.useState(false);

  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const nextHeight = getLegacyFormCustomTextareaHeight({
      scrollHeight: textarea.scrollHeight,
      currentHeight: height,
    });
    const nextScrollable = textarea.scrollHeight > (nextHeight ?? height);
    if (isScrollable !== nextScrollable) {
      setIsScrollable(nextScrollable);
    }
    if (nextHeight !== null) {
      setHeight(nextHeight);
    }
  }, [height, isScrollable, localValue]);

  return (
    <textarea
      ref={textareaRef}
      value={localValue}
      onChange={(event) => {
        const nextValue = event.target.value;
        setLocalValue(nextValue);
        onValueChange(nextValue);
      }}
      placeholder={placeholder}
      disabled={disabled}
      rows={2}
      onKeyDown={onKeyDown}
      style={{ height }}
      className={cn(
        'oc-surface-elevated w-full bg-surface-elevated border border-border/30 focus:border-interactive-border-focus rounded px-2 py-1 outline-none typography-meta text-foreground placeholder:text-muted-foreground/50 transition-colors resize-none',
        isScrollable ? 'overflow-y-auto' : 'overflow-hidden'
      )}
      autoFocus
    />
  );
});

/**
 * The v1 track's inline card for a blocking form (the wire's multi-question
 * `question.asked` request). The v2 typed-form surfaces are `FormCard` and
 * `FormDock`. Renamed from `QuestionCard` in spine S7; the draft-persistence
 * storage keys are unchanged so saved drafts survive the rename.
 */
export const LegacyFormCard: React.FC<LegacyFormCardProps> = ({ form, inline = false, resolveRequestTarget, submitStaleFormAnswer }) => {
  const { t } = useI18n();
  const replyToForm = sessionActions.replyToForm;
  const cancelForm = sessionActions.cancelForm;
  const isMobile = useUIStore((state) => state.isMobile);
  const sessions = useSessions();
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const isFromSubagent = React.useMemo(() => {
    if (!currentSessionId || form.sessionID === currentSessionId) return false;
    const sourceSession = sessions.find((session) => session.id === form.sessionID);
    return Boolean(sourceSession?.parentID && sourceSession.parentID === currentSessionId);
  }, [form.sessionID, currentSessionId, sessions]);
  const [activeTab, setActiveTab] = React.useState<TabKey>('0');
  const [isResponding, setIsResponding] = React.useState(false);
  const [hasResponded, setHasResponded] = React.useState(false);

  const [selectedOptions, setSelectedOptions] = React.useState<Record<number, string[]>>({});
  const [customMode, setCustomMode] = React.useState<Record<number, boolean>>({});
  const customTextRef = React.useRef<Record<number, string>>({});
  const [customTextFilled, setCustomTextFilled] = React.useState<Record<number, boolean>>({});
  const skipNextDraftSaveRef = React.useRef<string | null>(null);

  const questions = React.useMemo(() => form.questions ?? [], [form.questions]);
  const isSummaryTab = activeTab === SUMMARY_TAB;
  const activeIndex = isSummaryTab ? -1 : Math.max(0, Math.min(questions.length - 1, Number(activeTab) || 0));
  const activeQuestion = isSummaryTab ? null : questions[activeIndex];
  const activeHeader = React.useMemo(() => {
    if (isSummaryTab) return null;
    const header = activeQuestion?.header?.trim();
    return header && header.length > 0 ? header : null;
  }, [activeQuestion?.header, isSummaryTab]);

  React.useEffect(() => {
    const draft = loadFormDraft(form.id);
    skipNextDraftSaveRef.current = form.id;
    setActiveTab(draft?.activeTab ?? '0');
    setSelectedOptions(draft?.selectedOptions ?? {});
    setCustomMode(draft?.customMode ?? {});
    customTextRef.current = { ...(draft?.customText ?? {}) };
    const nextFilled: Record<number, boolean> = {};
    for (const [key, value] of Object.entries(customTextRef.current)) {
      const index = Number(key);
      if (Number.isFinite(index) && value.trim().length > 0) {
        nextFilled[index] = true;
      }
    }
    setCustomTextFilled(nextFilled);
    setHasResponded(isFormHandled(form.id) || (form.tool ? isFormHandledByTool(form.tool) : false));
  }, [form.id, form.tool]);

  React.useEffect(() => {
    if (hasResponded) return;
    if (skipNextDraftSaveRef.current === form.id) {
      skipNextDraftSaveRef.current = null;
      return;
    }

    saveFormDraft(form.id, {
      activeTab,
      selectedOptions,
      customMode,
      customText: customTextRef.current,
    });
  }, [activeTab, customMode, customTextFilled, hasResponded, form.id, selectedOptions]);

  const tabs = React.useMemo(() => {
    const questionTabs = questions.map((q, index) => ({
      value: String(index),
      label: q.header?.trim() || `Q${index + 1}`,
    }));
    // Add summary tab when multiple questions
    if (questions.length > 1) {
      questionTabs.push({ value: SUMMARY_TAB, label: t('chat.questionCard.summaryTab') });
    }
    return questionTabs;
  }, [questions, t]);

  // Helper to get answer display for a question index
  const getAnswerDisplay = React.useCallback((index: number): string => {
    const isCustom = Boolean(customMode[index]);
    if (isCustom) {
      const value = (customTextRef.current[index] ?? '').trim();
      return value || t('chat.questionCard.noAnswer');
    }
    const answers = selectedOptions[index] ?? [];
    return answers.length > 0 ? answers.join(', ') : t('chat.questionCard.noAnswer');
  }, [customMode, selectedOptions, t]);

  const isMultiple = Boolean(activeQuestion?.multiple);
  const selectedForActive = selectedOptions[activeIndex] ?? [];
  const isCustomActive = Boolean(customMode[activeIndex]);

  const unansweredIndexes = React.useMemo(() => {
    const pending: number[] = [];
    for (let index = 0; index < questions.length; index += 1) {
      const isCustom = Boolean(customMode[index]);
      if (isCustom) {
        if (!customTextFilled[index]) pending.push(index);
        continue;
      }

      const answers = selectedOptions[index] ?? [];
      if (answers.length === 0) {
        pending.push(index);
      }
    }
    return pending;
  }, [customMode, customTextFilled, questions.length, selectedOptions]);

  const requiredSatisfied = React.useMemo(() => {
    if (questions.length === 0) return false;
    return unansweredIndexes.length === 0;
  }, [questions.length, unansweredIndexes.length]);

  const handleNextUnanswered = React.useCallback(() => {
    if (questions.length === 0 || unansweredIndexes.length === 0) return;

    const start = isSummaryTab ? -1 : activeIndex;
    for (let offset = 1; offset <= questions.length; offset += 1) {
      const candidate = (start + offset + questions.length) % questions.length;
      if (unansweredIndexes.includes(candidate)) {
        setActiveTab(String(candidate));
        return;
      }
    }

    setActiveTab(String(unansweredIndexes[0]));
  }, [activeIndex, isSummaryTab, questions.length, unansweredIndexes]);

  const buildAnswersPayload = React.useCallback((): string[][] => {
    const answers: string[][] = [];

    for (let index = 0; index < questions.length; index += 1) {
      const isCustom = Boolean(customMode[index]);
      if (isCustom) {
        const value = (customTextRef.current[index] ?? '').trim();
        answers.push(value ? [value] : []);
        continue;
      }

      answers.push(selectedOptions[index] ?? []);
    }

    return answers;
  }, [customMode, questions.length, selectedOptions]);

  const resolveEffectiveRequestTarget = React.useCallback(async (): Promise<FormRequestTarget> => {
    if (!resolveRequestTarget) {
      return { kind: 'pending', requestId: form.id };
    }
    const target = await resolveRequestTarget();
    if (target.kind === 'stale') {
      return target;
    }
    if (!target.requestId.trim()) {
      throw new Error('Question reply target is not available');
    }
    return target;
  }, [form.id, resolveRequestTarget]);

  const handleToggleOption = React.useCallback(
    (label: string) => {
      if (!activeQuestion) return;

      setCustomMode((prev) => ({ ...prev, [activeIndex]: false }));
      setCustomTextFilled((prev) => (prev[activeIndex] ? { ...prev, [activeIndex]: false } : prev));

      setSelectedOptions((prev) => {
        const current = prev[activeIndex] ?? [];
        if (isMultiple) {
          const exists = current.includes(label);
          const next = exists ? current.filter((item) => item !== label) : [...current, label];
          return { ...prev, [activeIndex]: next };
        }
        return { ...prev, [activeIndex]: [label] };
      });
    },
    [activeIndex, activeQuestion, isMultiple]
  );

  const handleSelectCustom = React.useCallback(() => {
    setCustomMode((prev) => ({ ...prev, [activeIndex]: true }));
    setSelectedOptions((prev) => ({ ...prev, [activeIndex]: [] }));
    const hasValue = (customTextRef.current[activeIndex] ?? '').trim().length > 0;
    setCustomTextFilled((prev) => (prev[activeIndex] === hasValue ? prev : { ...prev, [activeIndex]: hasValue }));
  }, [activeIndex]);

  const handleCustomValueChange = React.useCallback((value: string) => {
    customTextRef.current = { ...customTextRef.current, [activeIndex]: value };
    const hasValue = value.trim().length > 0;
    setCustomTextFilled((prev) => (prev[activeIndex] === hasValue ? prev : { ...prev, [activeIndex]: hasValue }));
  }, [activeIndex]);

  const handleConfirm = React.useCallback(async () => {
    if (!requiredSatisfied) return;

    setIsResponding(true);
    try {
      const answers = buildAnswersPayload();
      const target = await resolveEffectiveRequestTarget();
      if (target.kind === 'stale') {
        if (!submitStaleFormAnswer) {
          throw new Error('Question is no longer pending');
        }
        await submitStaleFormAnswer(answers, target.directory);
      } else {
        await replyToForm(form.sessionID, target.requestId, answers, target.directory);
      }
      markFormHandled(form.id);
      if (form.tool) markFormHandledByTool(form.tool);
      setHasResponded(true);
    } catch (error) {
      const description = describeFormError(error);
      console.error('[LegacyFormCard] Failed to respond to form:', error);
      toast.error(t('chat.questionCard.replyFailed'), { description, copyText: description });
    } finally {
      setIsResponding(false);
    }
  }, [buildAnswersPayload, form.id, form.sessionID, form.tool, requiredSatisfied, resolveEffectiveRequestTarget, replyToForm, submitStaleFormAnswer, t]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isIMECompositionEvent(e)) return;

      if (e.key === 'Enter' && !e.shiftKey && (!isMobile || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (requiredSatisfied) {
          handleConfirm();
        } else {
          handleNextUnanswered();
        }
      }
    },
    [handleConfirm, handleNextUnanswered, isMobile, requiredSatisfied]
  );

  const handleDismiss = React.useCallback(async () => {
    setIsResponding(true);
    try {
      const target = await resolveEffectiveRequestTarget();
      if (target.kind !== 'stale') {
        await cancelForm(form.sessionID, target.requestId, target.directory);
      }
      markFormHandled(form.id);
      if (form.tool) markFormHandledByTool(form.tool);
      clearFormDraft(form.id);
      setHasResponded(true);
    } catch (error) {
      const description = describeFormError(error);
      console.error('[LegacyFormCard] Failed to dismiss form:', error);
      toast.error(t('chat.questionCard.dismissFailed'), { description, copyText: description });
    } finally {
      setIsResponding(false);
    }
  }, [form.id, form.sessionID, form.tool, cancelForm, resolveEffectiveRequestTarget, t]);

  const handleCopyMarkdown = React.useCallback(async () => {
    const result = await copyTextToClipboard(serializeFormAsMarkdown(form));
    if (result.ok) {
      toast.success(t('chat.questionCard.copiedMarkdown'));
      return;
    }
    toast.error(t('chat.questionCard.copyFailed'));
  }, [form, t]);

  const handleCopyJson = React.useCallback(async () => {
    const result = await copyTextToClipboard(serializeFormAsJson(form));
    if (result.ok) {
      toast.success(t('chat.questionCard.copiedJson'));
      return;
    }
    toast.error(t('chat.questionCard.copyFailed'));
  }, [form, t]);

  if (hasResponded || questions.length === 0) {
    return null;
  }

  const card = (
    <div className="-mt-1 border border-border/30 rounded-xl bg-muted/10">
          {/* Header */}
          <div className="px-2 py-1.5 border-b border-border/20">
            <div className="flex items-center gap-2">
              <Icon name="question" className="h-3.5 w-3.5 text-primary" />
              <span className="typography-meta font-medium text-muted-foreground">{t('chat.questionCard.inputNeeded')}</span>
              {isFromSubagent ? (
                <span className="typography-micro text-muted-foreground px-1.5 py-0.5 rounded bg-foreground/5">
                  {t('chat.questionCard.fromSubagent')}
                </span>
              ) : null}
              {activeHeader ? (
                <span className="ml-auto typography-micro font-medium text-foreground/70 px-1.5 py-0.5 rounded bg-muted/30 border border-border/20">
                  {activeHeader}
                </span>
              ) : null}
              <div className={cn('flex items-center gap-0.5', activeHeader ? null : 'ml-auto')}>
                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  title={t('chat.questionCard.copyMarkdown')}
                  aria-label={t('chat.questionCard.copyMarkdown')}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-interactive-hover/30 hover:text-foreground"
                >
                  <Icon name="file-text" className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={handleCopyJson}
                  title={t('chat.questionCard.copyJson')}
                  aria-label={t('chat.questionCard.copyJson')}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-interactive-hover/30 hover:text-foreground"
                >
                  <Icon name="code-box" className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          <div className="px-2 py-2">
            {/* Minimal inline tabs for multiple questions */}
            {tabs.length > 1 ? (
              <div className="flex items-center gap-1 mb-2 flex-wrap">
                {tabs.map((tab) => {
                  const isActive = activeTab === tab.value;
                  const isSummary = tab.value === SUMMARY_TAB;
                  const tabIndex = isSummary ? -1 : Number(tab.value);
                  const isAnswered = !isSummary && Number.isFinite(tabIndex) && !unansweredIndexes.includes(tabIndex);
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setActiveTab(tab.value)}
                      className={cn(
                        'px-2 py-0.5 typography-meta font-medium rounded transition-colors flex items-center gap-1',
                        isActive
                          ? 'bg-interactive-selection/40 text-foreground'
                          : isSummary
                            ? 'text-muted-foreground hover:text-foreground hover:bg-interactive-hover/20'
                            : isAnswered
                              ? 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-interactive-hover/20'
                              : 'text-foreground/85 hover:text-foreground hover:bg-interactive-hover/20'
                      )}
                    >
                      {isSummary ? <Icon name="list-check-3" className="h-3 w-3" /> : null}
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/* Summary view */}
            {isSummaryTab ? (
              <div className="space-y-2">
                {questions.map((q, index) => {
                  const answer = getAnswerDisplay(index);
                  const hasAnswer = answer !== t('chat.questionCard.noAnswer');
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setActiveTab(String(index))}
                      className="w-full text-left rounded px-1.5 py-1 hover:bg-interactive-hover/20 transition-colors"
                    >
                      <div className="typography-micro text-muted-foreground">{q.header || t('chat.questionCard.questionFallback', { index: index + 1 })}</div>
                      <div className={cn(
                        'typography-meta',
                        hasAnswer ? 'text-foreground' : 'text-muted-foreground/50 italic'
                      )}>
                        {answer}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : activeQuestion ? (
              <>
                <div className="typography-meta font-medium text-foreground mb-1.5">{activeQuestion.question}</div>

                {isMultiple ? (
                  <div className="typography-micro text-muted-foreground mb-1.5">{t('chat.questionCard.selectMultiple')}</div>
                ) : null}

                <div className="space-y-0.5">
                  {activeQuestion.options.map((option, index) => {
                    const selected = selectedForActive.includes(option.label);
                    const recommended = /\(recommended\)/i.test(option.label);

                    return (
                      <button
                        key={`${index}:${option.label}`}
                        type="button"
                        onClick={() => handleToggleOption(option.label)}
                        disabled={isResponding}
                        className={cn(
                          'w-full px-1.5 py-1 text-left rounded transition-colors',
                          'hover:bg-interactive-hover/30',
                          selected ? 'bg-interactive-selection/20' : null,
                          isResponding ? 'opacity-60 cursor-not-allowed' : null
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5 shrink-0">
                            {isMultiple ? (
                              <Checkbox
                                checked={selected}
                                onChange={() => handleToggleOption(option.label)}
                                disabled={isResponding}
                              />
                            ) : (
                              <Radio
                                checked={selected}
                                onChange={() => handleToggleOption(option.label)}
                                disabled={isResponding}
                              />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={cn(
                                'typography-meta break-all',
                                selected ? 'text-foreground font-medium' : 'text-foreground/80'
                              )}>
                                {option.label}
                              </span>
                              {recommended ? (
                                <span className="typography-micro text-primary/80">{t('chat.questionCard.recommended')}</span>
                              ) : null}
                            </div>
                            {option.description ? (
                              <div className="typography-micro text-muted-foreground break-words">{option.description}</div>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {/* Custom answer option */}
                  <button
                    type="button"
                    onClick={handleSelectCustom}
                    disabled={isResponding}
                    className={cn(
                      'w-full px-1.5 py-1 text-left rounded transition-colors',
                      'hover:bg-interactive-hover/30',
                      isCustomActive ? 'bg-interactive-selection/20' : null,
                      isResponding ? 'opacity-60 cursor-not-allowed' : null
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon name="edit" className={cn(
                        'h-3.5 w-3.5',
                        isCustomActive ? 'text-primary' : 'text-muted-foreground/50'
                      )} />
                      <span className={cn(
                        'typography-meta',
                        isCustomActive ? 'text-foreground font-medium' : 'text-muted-foreground'
                      )}>
                        {t('chat.questionCard.other')}
                      </span>
                    </div>
                  </button>

                  {isCustomActive ? (
                    <div className="pl-6 pr-1 pt-0.5">
                      <CustomAnswerTextarea
                        value={customTextRef.current[activeIndex] ?? ''}
                        onValueChange={handleCustomValueChange}
                        placeholder={t('chat.questionCard.yourAnswer')}
                        disabled={isResponding}
                        onKeyDown={handleKeyDown}
                      />
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          {/* Footer actions */}
          <div className="px-2 pb-1.5 pt-1 flex items-center gap-1.5 border-t border-border/20">
            <button
              type="button"
              onClick={requiredSatisfied ? handleConfirm : handleNextUnanswered}
              disabled={isResponding}
              className={cn(
                'flex items-center gap-1 px-2 py-1 typography-meta font-medium rounded transition-colors',
                'bg-[rgb(var(--status-success)/0.1)] text-[var(--status-success)] hover:bg-[rgb(var(--status-success)/0.2)]',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {requiredSatisfied ? <Icon name="check" className="h-3 w-3" /> : <Icon name="arrow-right-s" className="h-3 w-3" />}
              {requiredSatisfied ? t('chat.questionCard.submit') : t('chat.questionCard.next')}
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              disabled={isResponding}
              className={cn(
                'flex items-center gap-1 px-2 py-1 typography-meta font-medium rounded transition-colors',
                'bg-[rgb(var(--status-error)/0.1)] text-[var(--status-error)] hover:bg-[rgb(var(--status-error)/0.2)]',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <Icon name="close" className="h-3 w-3" />
              {t('chat.questionCard.dismiss')}
            </button>

            {isResponding ? (
              <div className="ml-auto">
                <div className="animate-spin h-3 w-3 border border-primary border-t-transparent rounded-full" />
              </div>
            ) : null}
          </div>
    </div>
  );

  return (
    <div className="group w-full pt-0 pb-2">
      {inline ? card : <div className="chat-column">{card}</div>}
    </div>
  );
};
