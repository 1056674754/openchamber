export const clampMobileSwipeOffset = (offset: number, actionsWidth: number): number => (
  Math.max(-actionsWidth, Math.min(0, offset))
);

export const shouldRevealMobileSwipeActions = (offset: number, actionsWidth: number): boolean => (
  offset < -(actionsWidth / 2)
);
