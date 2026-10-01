import { describe, expect, test } from 'bun:test';
import type { FormQuestion, FormOption, FormRequest } from '@/types/form';
import { serializeFormAnswersAsMarkdown, serializeFormAsJson, serializeFormAsMarkdown } from '../legacyFormSerializers';

function makeOption(label: string, description = ''): FormOption {
  return { label, description };
}

function makeQuestion(overrides: Partial<FormQuestion> & { question: string }): FormQuestion {
  return {
    header: '',
    options: [],
    ...overrides,
  };
}

function makeRequest(questions: FormQuestion[]): FormRequest {
  return {
    id: 'req-test',
    sessionID: 'sess-test',
    questions,
  };
}

describe('serializeFormAsMarkdown', () => {
  test('renders header, body and labelled options', () => {
    const md = serializeFormAsMarkdown(
      makeRequest([
        makeQuestion({
          header: 'Pick mode',
          question: 'Which mode should we use?',
          options: [makeOption('safe', 'Default'), makeOption('aggressive')],
        }),
      ]),
    );

    expect(md.startsWith('## Pick mode')).toBe(true);
    expect(md.includes('Which mode should we use?')).toBe(true);
    expect(md.includes('- **safe** — Default')).toBe(true);
    expect(md.includes('- **aggressive**')).toBe(true);
  });

  test('falls back to Question N when header is empty', () => {
    const md = serializeFormAsMarkdown(
      makeRequest([
        makeQuestion({ header: '   ', question: 'A?', options: [makeOption('yes')] }),
        makeQuestion({ header: '', question: 'B?', options: [makeOption('yes')] }),
      ]),
    );

    expect(md.includes('## Question 1')).toBe(true);
    expect(md.includes('## Question 2')).toBe(true);
  });

  test('emits multi-select hint only when multiple is true', () => {
    const single = serializeFormAsMarkdown(
      makeRequest([makeQuestion({ question: 'pick', options: [makeOption('a')] })]),
    );
    const multi = serializeFormAsMarkdown(
      makeRequest([makeQuestion({ question: 'pick', multiple: true, options: [makeOption('a')] })]),
    );

    expect(single.includes('_Select all that apply._')).toBe(false);
    expect(multi.includes('_Select all that apply._')).toBe(true);
  });

  test('elides blank descriptions', () => {
    const md = serializeFormAsMarkdown(
      makeRequest([
        makeQuestion({
          question: 'q?',
          options: [makeOption('x', '   '), makeOption('y', '')],
        }),
      ]),
    );

    expect(md.includes('- **x**')).toBe(true);
    expect(md.includes('- **y**')).toBe(true);
    expect(md.includes(' — ')).toBe(false);
  });

  test('serializes multiple questions in order', () => {
    const md = serializeFormAsMarkdown(
      makeRequest([
        makeQuestion({ header: 'First', question: 'one?', options: [makeOption('a')] }),
        makeQuestion({ header: 'Second', question: 'two?', options: [makeOption('b')] }),
      ]),
    );

    const firstIdx = md.indexOf('## First');
    const secondIdx = md.indexOf('## Second');
    expect(firstIdx >= 0).toBe(true);
    expect(secondIdx > firstIdx).toBe(true);
  });

  test('handles empty questions and zero-option questions', () => {
    expect(serializeFormAsMarkdown(makeRequest([]))).toBe('');

    const md = serializeFormAsMarkdown(
      makeRequest([makeQuestion({ header: 'Empty', question: 'free?', options: [] })]),
    );
    expect(md.includes('## Empty')).toBe(true);
    expect(md.includes('free?')).toBe(true);
  });
});

describe('serializeFormAsJson', () => {
  test('produces canonical envelope preserving option descriptions', () => {
    const json = serializeFormAsJson(
      makeRequest([
        makeQuestion({
          header: 'Pick',
          question: 'pick?',
          options: [makeOption('a', 'A desc'), makeOption('b')],
        }),
      ]),
    );

    expect(JSON.parse(json)).toEqual({
      questions: [
        {
          header: 'Pick',
          question: 'pick?',
          multiple: false,
          options: [
            { label: 'a', description: 'A desc' },
            { label: 'b', description: '' },
          ],
        },
      ],
    });
  });

  test('reflects multiple as a boolean and omits transient ids', () => {
    const json = serializeFormAsJson(
      makeRequest([
        makeQuestion({ question: 'q1', multiple: true, options: [makeOption('a')] }),
        makeQuestion({ question: 'q2', options: [makeOption('b')] }),
      ]),
    );
    const parsed = JSON.parse(json);

    expect(parsed.questions[0].multiple).toBe(true);
    expect(parsed.questions[1].multiple).toBe(false);
    expect(json.includes('req-test')).toBe(false);
    expect(json.includes('sess-test')).toBe(false);
  });

  test('uses null for missing runtime descriptions', () => {
    const json = serializeFormAsJson(
      makeRequest([
        makeQuestion({
          question: 'q?',
          options: [{ label: 'x' } as unknown as FormOption],
        }),
      ]),
    );

    expect(JSON.parse(json).questions[0].options[0]).toEqual({ label: 'x', description: null });
  });

  test('handles empty questions array with two-space indentation', () => {
    const json = serializeFormAsJson(makeRequest([]));

    expect(JSON.parse(json)).toEqual({ questions: [] });
    expect(json.includes('\n  "questions"')).toBe(true);
  });
});

describe('serializeFormAnswersAsMarkdown', () => {
  test('renders answers beside their original questions', () => {
    const md = serializeFormAnswersAsMarkdown(
      makeRequest([
        makeQuestion({ header: 'Mode', question: 'Which mode?', options: [makeOption('A')] }),
        makeQuestion({ question: 'Any notes?', options: [] }),
      ]),
      [['A'], ['Use the config page']],
    );

    expect(md.startsWith('I am answering the pending question')).toBe(true);
    expect(md.includes('## Mode')).toBe(true);
    expect(md.includes('Which mode?')).toBe(true);
    expect(md.includes('Answer: A')).toBe(true);
    expect(md.includes('## Question 2')).toBe(true);
    expect(md.includes('Answer: Use the config page')).toBe(true);
  });

  test('renders multi-answer and missing-answer values deterministically', () => {
    const md = serializeFormAnswersAsMarkdown(
      makeRequest([
        makeQuestion({ question: 'Tags?', multiple: true, options: [makeOption('A'), makeOption('B')] }),
        makeQuestion({ question: 'Empty?', options: [] }),
      ]),
      [['A', 'B']],
    );

    expect(md.includes('Answer: A, B')).toBe(true);
    expect(md.includes('Answer: (no answer)')).toBe(true);
  });
});
