import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const resolveDataDir = () => process.env.OPENCHAMBER_DATA_DIR
  ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
  : path.join(os.homedir(), '.config', 'openchamber');

export const readDiskCache = (fileName) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(resolveDataDir(), fileName), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const writeDiskCache = (fileName, data) => {
  const filePath = path.join(resolveDataDir(), fileName);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
    return true;
  } catch {
    try { fs.unlinkSync(temporary); } catch { /* ignore cleanup failure */ }
    return false;
  }
};
