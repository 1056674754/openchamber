const INITIAL_ROW_LIMIT = 24;

/**
 * Above this row count the JS row virtualizer pays for itself; below it every
 * row renders directly. The group paginator keeps ordinary sidebars well under
 * the limit, and direct rendering avoids the measured-size stickiness that has
 * produced blank spacers on ArkWeb, Capacitor, and desktop alike.
 */
export const SIDEBAR_STATIC_ROW_LIMIT = 240;

export const shouldVirtualizeSessionSidebarRows = (args: {
  platformDisabled: boolean;
  rowCount: number;
}): boolean => {
  if (args.platformDisabled) return false;
  return args.rowCount > SIDEBAR_STATIC_ROW_LIMIT;
};

export const getInitialSessionSidebarRowIndexes = (rowCount: number): number[] => (
  Array.from({ length: Math.min(rowCount, INITIAL_ROW_LIMIT) }, (_, index) => index)
);

export const mergeSessionSidebarVirtualIndexes = (
  visibleIndexes: readonly number[],
  pinnedIndexes: ReadonlySet<number>,
  rowCount: number,
): number[] => {
  const indexes = new Set(visibleIndexes);
  for (const index of pinnedIndexes) {
    if (index >= 0 && index < rowCount) indexes.add(index);
  }
  return [...indexes].sort((left, right) => left - right);
};

export const findFirstVisibleSessionSidebarRowIndex = (
  items: readonly { index: number; end: number }[],
  scrollOffset: number,
): number => items.find((item) => item.end > scrollOffset)?.index ?? 0;
