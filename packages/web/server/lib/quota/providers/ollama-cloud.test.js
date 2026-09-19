import { describe, expect, it } from 'vitest';
import { parseOllamaSettingsHtml } from './ollama-cloud.js';

describe('Ollama Cloud settings page parsing', () => {
  it('parses session/weekly/premium windows', () => {
    const windows = parseOllamaSettingsHtml('<p>Session usage: 42%</p><p>Weekly usage: 7%</p><p>Premium 120 / 1000</p>');
    expect(windows.session.usedPercent).toBe(42);
    expect(windows.weekly.usedPercent).toBe(7);
    expect(windows.premium.usedPercent).toBe(12);
    expect(windows.premium.valueLabel).toBe('120 / 1000');
  });

  it('parses the cost-based monthly usage shape', () => {
    const html = '<span class="text-sm">Monthly usage</span>\n      <span class="text-sm "\n        >$4.39 of $60 used</span\n      >';
    const windows = parseOllamaSettingsHtml(html);
    expect(windows.monthly.usedPercent).toBeCloseTo(7.3, 1);
    expect(windows.monthly.valueLabel).toBe('$4.39 / $60');
    expect(windows.monthly.remainingPercent).toBeCloseTo(92.7, 1);
  });

  it('parses the extra-usage credits balance', () => {
    const html = '<div><span>Balance remaining</span><span>$12.50</span></div><button>Add $5</button>';
    const windows = parseOllamaSettingsHtml(html);
    expect(windows.credits_balance.usedPercent).toBeNull();
    expect(windows.credits_balance.valueLabel).toBe('$12.50');
  });

  it('omits the credits balance when it is zero', () => {
    const html = '<div><span>Balance remaining</span><span>$0.00</span></div>';
    expect(parseOllamaSettingsHtml(html).credits_balance).toBeUndefined();
  });

  it('ignores nearby dollar amounts that are not the balance', () => {
    expect(parseOllamaSettingsHtml('<p>Add $5 to your balance when it hits $0</p>').credits_balance).toBeUndefined();
  });
});
