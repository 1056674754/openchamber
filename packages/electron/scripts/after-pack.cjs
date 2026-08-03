const fs = require('node:fs');
const path = require('node:path');
const {
  resolveEmbeddedOpenCodeSource,
  stageEmbeddedOpenCode,
} = require('./embedded-opencode.cjs');
const {
  resolveEmbeddedBunSource,
  stageEmbeddedBun,
} = require('./embedded-bun.cjs');

module.exports = (context) => {
  if (context.electronPlatformName === 'win32') {
    const resourcesPath = path.join(context.appOutDir, 'resources');
    const embedded = stageEmbeddedOpenCode({
      source: resolveEmbeddedOpenCodeSource(),
      resourcesPath,
      binaryName: 'opencode.exe',
      requireSigning: false,
    });
    console.log(`[electron] embedded custom Windows OpenCode ${embedded.version} at ${embedded.binaryPath}`);
    return;
  }

  if (context.electronPlatformName === 'linux') {
    const resourcesPath = path.join(context.appOutDir, 'resources');
    const embedded = stageEmbeddedOpenCode({
      source: resolveEmbeddedOpenCodeSource(),
      resourcesPath,
      requireSigning: false,
    });
    console.log(`[electron] embedded custom OpenCode ${embedded.version} at ${embedded.binaryPath}`);
    return;
  }

  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appBundlePath = path.join(context.appOutDir, `${appName}.app`);
  const resourcesPath = path.join(appBundlePath, 'Contents', 'Resources');
  const sourceAssetsPath = path.join(__dirname, '..', 'resources', 'icons', 'Assets.car');

  if (!fs.existsSync(sourceAssetsPath)) {
    throw new Error(`Missing compiled app icon asset catalog at ${sourceAssetsPath}`);
  }

  fs.copyFileSync(sourceAssetsPath, path.join(resourcesPath, 'Assets.car'));

  const embedded = stageEmbeddedOpenCode({
    source: resolveEmbeddedOpenCodeSource(),
    resourcesPath,
    signingIdentity: process.env.CSC_NAME,
  });
  console.log(`[electron] embedded signed OpenCode ${embedded.version} at ${embedded.binaryPath}`);

  const engine = stageEmbeddedBun({
    source: resolveEmbeddedBunSource(),
    resourcesPath,
    signingIdentity: process.env.CSC_NAME,
  });
  console.log(`[electron] embedded signed Bun engine ${engine.version} at ${engine.binaryPath}`);
};
