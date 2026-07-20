import { describe, expect, test } from 'bun:test';

import { formatToolInput, getToolMetadata } from '@/lib/toolHelpers';

import {
  buildToolInputPresentation,
  buildToolResultSummary,
  matchesToolInputSummary,
} from './toolInputPresentation';

describe('buildToolInputPresentation', () => {
  test('turns a look_at image path and goal into previewable context', () => {
    const presentation = buildToolInputPresentation('look_at', {
      file_path: '/tmp/course-tabs.png',
      goal: 'Count every visible course tab',
    });

    expect(presentation.summary).toBe('Count every visible course tab');
    expect(presentation.summaryLabel).toBe('Goal');
    expect(presentation.media).toEqual([
      {
        label: 'course-tabs.png',
        source: '/tmp/course-tabs.png',
      },
    ]);
    expect(presentation.fields.find((field) => field.key === 'goal')).toEqual({
      key: 'goal',
      kind: 'text',
      label: 'Goal',
      value: 'Count every visible course tab',
    });
  });

  test('supports multiple image paths supplied to look_at', () => {
    const presentation = buildToolInputPresentation('look_at', {
      file_paths: ['/tmp/first.png', '/tmp/second.webp'],
    });

    expect(presentation.media.map((item) => item.source)).toEqual([
      '/tmp/first.png',
      '/tmp/second.webp',
    ]);
    expect(presentation.summaryLabel).toBe('Images');
  });

  test('summarizes generic MCP tools using their meaningful input', () => {
    const presentation = buildToolInputPresentation('openmemory_search_memory', {
      query: 'course retirement behavior',
      user_id: 'song',
    });

    expect(presentation.summary).toBe('course retirement behavior');
    expect(presentation.fields[0]).toEqual({
      key: 'query',
      kind: 'text',
      label: 'Query',
      value: 'course retirement behavior',
    });
  });

  test('recognizes image sources used by external MCP tools', () => {
    const presentation = buildToolInputPresentation('zai_mcp_server_analyze_image', {
      image_source: 'https://example.com/screenshot.jpg',
      prompt: 'Explain the layout problem',
    });

    expect(presentation.summary).toBe('Explain the layout problem');
    expect(presentation.media).toEqual([
      {
        label: 'screenshot.jpg',
        source: 'https://example.com/screenshot.jpg',
      },
    ]);
  });

  test('never exposes secret-like arguments in structured fields', () => {
    const presentation = buildToolInputPresentation('custom_api_call', {
      api_key: 'sk-secret',
      authorization: 'Bearer secret',
      credentials: { client_secret: 'credential-secret' },
      password: 'not-for-display',
      private_key: 'private-key-secret',
      query: 'safe search text',
    });

    expect(presentation.fields.map((field) => field.key)).toEqual(['query']);
    expect(JSON.stringify(presentation)).not.toContain('secret');
    expect(JSON.stringify(presentation)).not.toContain('not-for-display');
    expect(JSON.stringify(presentation)).not.toContain('private-key');
  });

  test('redacts top-level and nested secrets from the raw input fallback', () => {
    const formatted = formatToolInput({
      apiKey: 'top-level-secret',
      private_key: 'private-key-secret',
      request: {
        credentials: 'nested-credentials-secret',
        query: 'safe search text',
        headers: {
          authorization: 'Bearer nested-secret',
          cookie: 'session=nested-cookie',
        },
      },
    }, 'custom_api_call');

    expect(formatted).toContain('[redacted]');
    expect(formatted).toContain('safe search text');
    expect(formatted).not.toContain('top-level-secret');
    expect(formatted).not.toContain('private-key-secret');
    expect(formatted).not.toContain('nested-credentials-secret');
    expect(formatted).not.toContain('nested-secret');
    expect(formatted).not.toContain('nested-cookie');
  });

  test('uses action-first names for OMO and external MCP tools', () => {
    expect(getToolMetadata('look_at').displayName).toBe('Inspect Media');
    expect(getToolMetadata('openmemory_search_memory').displayName).toBe('Search memory');
    expect(getToolMetadata('zai_mcp_server_analyze_image').displayName).toBe('Analyze image');
    expect(getToolMetadata('zai_mcp_server_extract_text_from_screenshot').displayName).toBe('Extract text from screenshot');
  });

  test('reduces multiline tool output to a clean one-line result summary', () => {
    const summary = buildToolResultSummary(`
      - **Visible tabs:** Today, Tasks, Gradebook, Attendance

      The second row is not visible.
      <task_metadata>{"sessionId":"ses_123"}</task_metadata>
    `);

    expect(summary).toBe('Visible tabs: Today, Tasks, Gradebook, Attendance The second row is not visible.');
  });

  test('limits result summaries without leaking task metadata', () => {
    const summary = buildToolResultSummary(`${'Result '.repeat(50)}\n<task_metadata>secret-session</task_metadata>`);

    expect(summary.length <= 180).toBe(true);
    expect(summary.endsWith('…')).toBe(true);
    expect(summary).not.toContain('secret-session');
  });

  test('matches the untruncated prompt source when suppressing duplicate media headers', () => {
    const description = '检查课程标题下方的功能导航。'.repeat(20);
    const input = {
      description,
      file_path: '/tmp/course-tabs.png',
    };
    const presentation = buildToolInputPresentation('look_at', input);

    expect(presentation.summary.endsWith('…')).toBe(true);
    expect(presentation.summary.length).toBe(160);
    expect(matchesToolInputSummary(description, input, presentation)).toBe(true);
    expect(matchesToolInputSummary('正在分析图片', input, presentation)).toBe(false);
  });
});
