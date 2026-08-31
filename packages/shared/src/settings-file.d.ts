/**
 * Type declarations for settings-file.js — fail-closed write guard and
 * previous-generation backup for the shared settings.json file. Plain JS +
 * adjacent .d.ts (same rationale as settings-lock.d.ts: the Node production
 * server must not depend on TS type-stripping at runtime).
 */

/**
 * Resolve when `filePath` is absent (valid starting state) or contains a JSON
 * object; throw when it exists but is unreadable, invalid JSON, or a
 * non-object root. Call immediately before replacing the file.
 */
export declare function assertJsonFileReadableForWrite(filePath: string, label?: string): Promise<void>;

/**
 * Copy `filePath` to `${filePath}.prev` as a one-generation recovery point.
 * Best-effort: never throws.
 */
export declare function copyPreviousGeneration(filePath: string): Promise<void>;
