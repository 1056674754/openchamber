export const getVisiblePermissionPatterns = (
  patterns: readonly string[],
  renderedCommand: string,
): string[] => {
  if (!renderedCommand) return [...patterns];
  return patterns.filter((pattern) => pattern !== renderedCommand);
};
