export const readTaskTagSessionIdFromOutput = (output: string): string | undefined => {
    const taskTagMatch = output.match(/<task\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>/i);
    return taskTagMatch?.[1];
};
