#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PACKAGE_JSON = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

export { PACKAGE_JSON };
export * from './bin/cli.js';
