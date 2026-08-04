/**
 * Type declarations for rpc-classes.js — consumed by the TypeScript UI package.
 * The implementation stays plain JS so the Node-based production server
 * (Electron loads @openchamber/web/server/index.js directly) never depends on
 * TS type-stripping at runtime.
 */

export type RpcClass = 'critical' | 'fast' | 'normal' | 'io' | 'ai' | 'stream';

export declare const RPC_CLASS: {
  CRITICAL: 'critical';
  FAST: 'fast';
  NORMAL: 'normal';
  IO: 'io';
  AI: 'ai';
  STREAM: 'stream';
};

export declare const RPC_CLASS_DEFAULT_TIMEOUT_MS: Record<RpcClass, number | null>;

export declare function classifyRpcPath(pathname: string, method?: string): RpcClass;

export declare function getRpcClassTimeoutMs(pathname: string, method?: string): number | null;
