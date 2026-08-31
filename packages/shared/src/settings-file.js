import fsp from 'node:fs/promises';

/**
 * Fail-closed write guard for the shared settings.json file.
 *
 * Every writer of settings.json reads the current file as its merge base.
 * Readers are lenient (a corrupt file reads as {}), so a writer that does not
 * re-check the file would persist its {}-derived merge over the original
 * content and wipe every key absent from the write — the historical
 * desktopSshInstances / remoteInstances data loss. Writers must call this
 * immediately before replacing the file; the verdict is taken at write time
 * so it cannot go stale between a read-modify-write's read and write phases.
 *
 * ENOENT resolves: a missing file is a valid starting state.
 */
export const assertJsonFileReadableForWrite = async (filePath, label = 'settings') => {
  let raw;
  try {
    raw = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return;
    throw new Error(`Refusing to write ${label}: ${filePath} could not be read (${error && error.message ? error.message : error}); repair or remove the file first`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Refusing to write ${label}: ${filePath} is not valid JSON (${error && error.message ? error.message : error}); repair or remove the file first`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Refusing to write ${label}: ${filePath} is not a JSON object; repair or remove the file first`);
  }
};

/**
 * Keep one previous generation of the file as a local recovery point before
 * an atomic replacement overwrites it. Best-effort: absence or an unreadable
 * source must never block the write itself.
 */
export const copyPreviousGeneration = async (filePath) => {
  try {
    await fsp.copyFile(filePath, `${filePath}.prev`);
  } catch {
    // Best-effort by contract.
  }
};
