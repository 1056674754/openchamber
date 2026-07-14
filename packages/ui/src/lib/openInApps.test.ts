import { describe, expect, test } from 'bun:test';
import { getOpenInAppById } from './openInApps';

describe('open-in app registry', () => {
  test('recognizes VS Code Insiders with its macOS application name', () => {
    expect(getOpenInAppById('vscode-insiders')).toEqual({
      id: 'vscode-insiders',
      label: 'VS Code Insiders',
      appName: 'Visual Studio Code - Insiders',
    });
  });
});
