// Minimal type declarations for bun:test to satisfy tsc.
// Only the subset used by our test files is declared.

declare module "bun:test" {
  type ExpectMatchers = {
    toEqual(expected: unknown): void;
    toBe(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toThrow(expected?: string | RegExp | (new (...args: never[]) => Error)): void;
    toContain(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toHaveLength(expected: number): void;
    toBeInstanceOf(expected: unknown): void;
    rejects: {
      toThrow(expected?: string | RegExp | (new (...args: never[]) => Error)): Promise<void>;
    };
    not: {
      toEqual(expected: unknown): void;
      toBe(expected: unknown): void;
      toContain(expected: unknown): void;
      toBeNull(): void;
      toBeDefined(): void;
      toBeUndefined(): void;
    };
  };

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): ExpectMatchers;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function mock<T extends (...args: never[]) => unknown>(fn?: T): T & {
    mockReset(): void;
    mockImplementation(fn: T): void;
  };
  export namespace mock {
    function module(moduleName: string, factory: () => Record<string, unknown>): void;
  }
}
