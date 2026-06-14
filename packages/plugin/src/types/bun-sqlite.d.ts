declare module "bun:sqlite" {
  export interface Statement<T = Record<string, unknown>> {
    get(...params: unknown[]): T | null
    all(...params: unknown[]): T[]
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }
  export class Database {
    constructor(filename: string, options?: { readonly?: boolean; create?: boolean })
    run(sql: string, ...params: unknown[]): void
    prepare<T = Record<string, unknown>>(sql: string): Statement<T>
    exec(sql: string): void
    close(): void
    serialize(): Uint8Array
  }
}
