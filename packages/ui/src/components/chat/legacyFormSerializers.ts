import type { FormRequest } from '@/types/form';

/**
 * Serializers for the v1 track's blocking-form request (the wire's
 * multi-question `question.asked` payload), so the user can carry an agent's
 * question into another tool. The v2 typed-form serializers live in
 * `./formSerializers`. The emitted content strings are unchanged from the
 * pre-rename serializers — only the module and function names moved.
 */

export function serializeFormAsMarkdown(form: FormRequest): string {
  const lines: string[] = [];
  const questions = form.questions ?? [];

  questions.forEach((q, index) => {
    const header = q.header?.trim();
    const title = header && header.length > 0 ? header : `Question ${index + 1}`;
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(q.question);
    lines.push('');

    if (q.multiple) {
      lines.push('_Select all that apply._');
      lines.push('');
    }

    q.options.forEach((option) => {
      const label = option.label;
      const description = option.description?.trim();
      lines.push(description ? `- **${label}** — ${description}` : `- **${label}**`);
    });

    lines.push('');
  });

  return lines.join('\n').trimEnd();
}

export function serializeFormAsJson(form: FormRequest): string {
  const payload = {
    questions: (form.questions ?? []).map((q) => ({
      header: q.header ?? null,
      question: q.question,
      multiple: Boolean(q.multiple),
      options: q.options.map((option) => ({
        label: option.label,
        description: option.description ?? null,
      })),
    })),
  };

  return JSON.stringify(payload, null, 2);
}

export function serializeFormAnswersAsMarkdown(form: FormRequest, answers: readonly (readonly string[])[]): string {
  const lines: string[] = [
    'I am answering the pending question that was shown earlier:',
    '',
  ];
  const questions = form.questions ?? [];

  questions.forEach((q, index) => {
    const header = q.header?.trim();
    const title = header && header.length > 0 ? header : `Question ${index + 1}`;
    const selected = answers[index] ?? [];
    const answer = selected.length > 0 ? selected.join(', ') : '(no answer)';

    lines.push(`## ${title}`);
    lines.push('');
    lines.push(q.question);
    lines.push('');
    lines.push(`Answer: ${answer}`);
    lines.push('');
  });

  return lines.join('\n').trimEnd();
}
