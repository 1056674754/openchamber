import path from 'node:path';
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export const createOpenCodeLifecycleJournal = ({
  dataDir,
  logger = console,
  maxBytes = DEFAULT_MAX_BYTES,
  now = () => new Date().toISOString(),
  processId = process.pid,
}) => {
  const logPath = path.join(dataDir, 'logs', 'opencode-lifecycle.jsonl');
  const rotatedPath = `${logPath}.1`;
  let pendingWrite = Promise.resolve();
  let warned = false;

  const appendEntry = async (entry) => {
    const line = `${JSON.stringify(entry)}\n`;
    const lineBytes = Buffer.byteLength(line);
    await mkdir(path.dirname(logPath), { recursive: true });

    let currentBytes = 0;
    try {
      currentBytes = (await stat(logPath)).size;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    if (currentBytes > 0 && currentBytes + lineBytes > maxBytes) {
      await rm(rotatedPath, { force: true });
      try {
        await rename(logPath, rotatedPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    await appendFile(logPath, line, 'utf8');
  };

  const record = (event, details = {}) => {
    const entry = {
      timestamp: now(),
      event,
      openChamberPid: processId,
      details,
    };
    pendingWrite = pendingWrite
      .then(() => appendEntry(entry))
      .catch((error) => {
        if (!warned) {
          warned = true;
          logger.warn('[OpenCode lifecycle] Failed to write lifecycle journal:', error);
        }
      });
    return pendingWrite;
  };

  return {
    path: logPath,
    record,
    flush: () => pendingWrite,
  };
};
