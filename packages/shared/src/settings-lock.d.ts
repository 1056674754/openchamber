/**
 * Type declarations for settings-lock.js — cross-process exclusive lock for
 * settings.json. The implementation stays plain JS (same rationale as
 * rpc-classes.d.ts: the Node production server must not depend on TS
 * type-stripping at runtime).
 */

export type SettingsLockErrorCodes = 'SETTINGS_LOCK_TIMEOUT' | 'LOCK_BUSY';

export type SettingsLockTimeoutError = Error & {
  code: 'SETTINGS_LOCK_TIMEOUT';
  lockPath: string;
  waitedMs: number;
  ownerPid?: number;
};

export type SettingsLockOptions = {
  /** Total bounded wait before throwing SETTINGS_LOCK_TIMEOUT. Default 250ms. */
  timeoutMs?: number;
  /** Lock files older than this are considered stale and stolen. Default 30s. */
  staleMs?: number;
};

/**
 * Run `fn` while holding an exclusive cross-process lock at `lockPath`.
 * Short bounded wait: absorbs normal RMW contention, fails fast otherwise.
 */
export declare function withSettingsLock<T>(
  lockPath: string,
  fn: () => T | Promise<T>,
  options?: SettingsLockOptions,
): Promise<T>;

/** `<settingsFilePath>.lock` next to the settings file. */
export declare function defaultSettingsLockPath(settingsFilePath: string): string;
