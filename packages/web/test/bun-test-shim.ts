import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test,
  vi,
} from 'vitest';

const mock = Object.assign(
  <T extends (...args: never[]) => unknown>(implementation?: T) => vi.fn(implementation),
  {
    module: vi.mock,
    restore: vi.restoreAllMocks,
  },
);
const spyOn = vi.spyOn;
const setSystemTime = vi.setSystemTime;

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
  spyOn,
  test,
  vi,
};
