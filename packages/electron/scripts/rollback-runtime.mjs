import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readAndValidateRuntime } from '../runtime-loader.mjs';

const installRoot = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'OpenChamber',
  'runtime',
);
const currentLink = path.join(installRoot, 'current');
const previousLink = path.join(installRoot, 'previous');

const currentTarget = fs.readlinkSync(currentLink);
const previousTarget = fs.readlinkSync(previousLink);
readAndValidateRuntime(path.resolve(installRoot, previousTarget));

const replaceSymlink = (linkPath, target) => {
  const temporary = `${linkPath}.new-${process.pid}`;
  fs.rmSync(temporary, { force: true, recursive: false });
  fs.symlinkSync(target, temporary);
  fs.renameSync(temporary, linkPath);
};

replaceSymlink(currentLink, previousTarget);
replaceSymlink(previousLink, currentTarget);
console.log(`[electron] runtime rolled back: ${previousTarget}`);

