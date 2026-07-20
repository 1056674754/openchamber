import { describe, expect, test } from 'bun:test';

import { isExpandableTool, isStandaloneTool, isStaticTool } from './toolRenderUtils';

describe('tool rendering classification', () => {
  test('renders custom MCP tools as expandable so their input and result are inspectable', () => {
    const toolName = 'openmemory_search_memory';

    expect(isExpandableTool(toolName)).toBe(true);
    expect(isStaticTool(toolName)).toBe(false);
  });

  test('keeps known compact tools static and task tools standalone', () => {
    expect(isStaticTool('grep')).toBe(true);
    expect(isExpandableTool('grep')).toBe(false);
    expect(isStandaloneTool('task')).toBe(true);
  });
});
