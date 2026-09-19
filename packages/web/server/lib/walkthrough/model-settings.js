import fs from 'fs';
import os from 'os';
import path from 'path';
import { readMergedSettingsSync } from '../opencode/settings-files.js';

// The walkthrough may run on a different model than the rest of the small-model
// callers. Those callers want cheap and fast; this one needs structured output
// and enough context for a whole diff, and forcing one setting to serve both
// means the user has to degrade one feature to fix the other.

const settingsFilePath = () => path.join(
  process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : path.join(os.homedir(), '.config', 'openchamber'),
  'settings.json',
);

export function readWalkthroughModelOverride() {
  // No settings file, unreadable, or malformed all mean the same thing: no
  // override, use the small model.
  const settings = readMergedSettingsSync({ fs, path, settingsFilePath: settingsFilePath() });
  const override = typeof settings.walkthroughModelOverride === 'string'
    ? settings.walkthroughModelOverride.trim()
    : '';
  return override || null;
}
