#!/usr/bin/env node
// hdc-based device deploy for the HarmonyOS shell (mirrors
// packages/mobile/scripts/android-device.mjs): devices / install / launch /
// run / log. The HAP path matches hvigor's assembleHap debug output.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_NAME = 'com.sscity.openchamber';
const ABILITY_NAME = 'EntryAbility';
const outputsDir = join(packageRoot, 'entry/build/default/outputs/default');
const signedHap = join(outputsDir, 'entry-default-signed.hap');
const unsignedHap = join(outputsDir, 'entry-default-unsigned.hap');
const hapPath = process.env.OPENCHAMBER_HAP_PATH
  || (existsSync(signedHap) ? signedHap : unsignedHap);

const hdc = process.env.HDC || 'hdc';

const runHdc = (args, { capture = false } = {}) => {
  const result = spawnSync(hdc, args, { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (result.error || result.status !== 0) {
    if (!capture) {
      console.error(`[ohos-device] ${hdc} ${args.join(' ')} failed`);
    }
    return null;
  }
  return result.stdout ?? '';
};

const requireDevice = () => {
  const output = runHdc(['list', 'targets'], { capture: true });
  if (output === null) {
    console.error('[ohos-device] cannot talk to hdc — is it on PATH (or set HDC)?');
    process.exit(1);
  }
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const targets = lines.filter((line) => !line.startsWith('Failed') && line !== '[Empty]');
  if (targets.length === 0) {
    console.error('[ohos-device] no connected device/emulator. Run `hdc list targets`; '
      + 'start the Device Manager emulator or connect a phone with USB debugging.');
    process.exit(1);
  }
  console.log(targets.join('\n'));
};

const requireHap = () => {
  if (!existsSync(hapPath)) {
    console.error(`[ohos-device] HAP not found at ${hapPath} — run 'bun run build:debug' first.`);
    process.exit(1);
  }
  if (hapPath === unsignedHap) {
    console.error('[ohos-device] HAP is UNSIGNED. Devices reject unsigned HAPs. One-time fix:\n'
      + '  open packages/harmony in DevEco Studio → File > Project Structure > Signing Configs →\n'
      + '  check "Automatically generate signature" and sign in with the Huawei account.\n'
      + '  That writes signingConfigs into build-profile.json5; after that CLI builds are signed too.');
    process.exit(1);
  }
};

const sub = process.argv[2] ?? '';
switch (sub) {
  case 'devices':
    requireDevice();
    break;
  case 'install':
    requireHap();
    runHdc(['install', '-r', hapPath]);
    break;
  case 'launch':
    runHdc(['shell', 'aa', 'start', '-a', ABILITY_NAME, '-b', BUNDLE_NAME]);
    break;
  case 'run':
    requireHap();
    runHdc(['install', '-r', hapPath]);
    if (runHdc(['shell', 'aa', 'start', '-a', ABILITY_NAME, '-b', BUNDLE_NAME], { capture: true }) === null) {
      process.exit(1);
    }
    break;
  case 'log': {
    const pid = runHdc(['shell', 'pidof', BUNDLE_NAME], { capture: true })?.trim();
    const args = pid ? ['shell', 'hilog', '--pid', pid] : ['shell', 'hilog'];
    if (!pid) console.error('[ohos-device] app not running — streaming full hilog');
    runHdc(args);
    break;
  }
  default:
    console.error('[ohos-device] usage: ohos-device.mjs <devices|install|launch|run|log>');
    process.exit(1);
}
