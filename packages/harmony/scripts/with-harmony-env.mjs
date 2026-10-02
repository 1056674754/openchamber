#!/usr/bin/env node
// Toolchain wrapper for every harmony build/deploy command (mirrors
// packages/mobile/scripts/with-mobile-env.mjs). Env overrides win; defaults
// target the DevEco Studio bundles so no global installs are needed.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const defaultDevEcoApp = '/Applications/DevEco-Studio.app';
const defaultSdk = join(defaultDevEcoApp, 'Contents/sdk');
const defaultHvigor = join(defaultDevEcoApp, 'Contents/tools/hvigor');
const defaultNode = join(defaultDevEcoApp, 'Contents/tools/node');

const devecoSdk = process.env.DEVECO_SDK_HOME
  || (existsSync(defaultSdk) ? defaultSdk : undefined);
if (!devecoSdk) {
  console.error('[with-harmony-env] DEVECO_SDK_HOME is not set and DevEco Studio was not found at '
    + `${defaultDevEcoApp}. Install DevEco Studio or export DEVECO_SDK_HOME.`);
  process.exit(1);
}

const hvigorHome = process.env.OPENCHAMBER_HVIGOR_HOME
  || (existsSync(join(defaultHvigor, 'bin', 'hvigorw.js')) ? defaultHvigor : undefined);
const nodeBin = process.env.OPENCHAMBER_NODE_BIN
  || (existsSync(join(defaultNode, 'bin', 'node')) ? join(defaultNode, 'bin') : undefined);

const env = { ...process.env, DEVECO_SDK_HOME: devecoSdk };

// The HAP packer is a Java tool; reuse the JDK 21 the mobile package standardizes on.
const defaultJavaHome = '/opt/homebrew/opt/openjdk@21';
const javaHome = env.JAVA_HOME || (existsSync(defaultJavaHome) ? defaultJavaHome : undefined);
if (javaHome) {
  env.JAVA_HOME = javaHome;
  env.PATH = `${join(javaHome, 'bin')}:${env.PATH ?? ''}`;
}

const pathPrepend = [];
if (nodeBin) pathPrepend.push(nodeBin);
// hdc ships with the SDK toolchains; also honor an existing ~/bin/hdc install.
const sdkHdcDir = join(devecoSdk, 'openharmony', 'toolchains');
if (existsSync(sdkHdcDir)) pathPrepend.push(sdkHdcDir);
if (pathPrepend.length > 0) {
  env.PATH = `${pathPrepend.join(':')}:${process.env.PATH ?? ''}`;
}

const command = process.argv[2];
if (!command) {
  console.error('[with-harmony-env] usage: with-harmony-env.mjs "<command>"');
  process.exit(1);
}

// `hvigorw` is rewritten to the DevEco-bundled hvigor CLI invoked directly.
// The stock wrapper would npm/pnpm-install hvigor per project (network + slow);
// the bundled distribution already ships hvigor + the ohos plugin, it just needs
// NODE_PATH so `@ohos/hvigor` resolves next to `@ohos/hvigor-ohos-plugin`
// (DevEco Studio sets up the same layout at runtime).
let finalCommand = command;
if (command.startsWith('hvigorw') && hvigorHome) {
  const hvigorArgs = command.slice('hvigorw'.length).trim();
  const cli = join(hvigorHome, 'hvigor', 'bin', 'hvigor.js');
  const pluginModules = join(hvigorHome, 'node_modules');
  finalCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} ${hvigorArgs}`;
  env.NODE_PATH = pluginModules;
  env.HVIGOR_USER_HOME = env.HVIGOR_USER_HOME || join(process.env.HOME ?? '', '.hvigor');
}

const child = spawn(finalCommand, {
  shell: true,
  stdio: 'inherit',
  cwd: packageRoot,
  env,
});
const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? (signal ? 1 : 0));
});
