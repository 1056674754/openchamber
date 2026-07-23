export type FileMentionAutocompleteInputSource = 'manual' | 'paste';

const getInsertedTextFromChange = (previousValue: string, nextValue: string): string => {
    if (previousValue === nextValue) return '';

    let prefixLength = 0;
    while (
        prefixLength < previousValue.length
        && prefixLength < nextValue.length
        && previousValue[prefixLength] === nextValue[prefixLength]
    ) {
        prefixLength += 1;
    }

    let previousSuffix = previousValue.length;
    let nextSuffix = nextValue.length;
    while (
        previousSuffix > prefixLength
        && nextSuffix > prefixLength
        && previousValue[previousSuffix - 1] === nextValue[nextSuffix - 1]
    ) {
        previousSuffix -= 1;
        nextSuffix -= 1;
    }

    return nextValue.slice(prefixLength, nextSuffix);
};

export const getPastedInsertedText = ({
    previousValue,
    nextValue,
    inputType,
    pasteMarked,
}: {
    previousValue: string;
    nextValue: string;
    inputType?: string;
    pasteMarked: boolean;
}): string => {
    if (!pasteMarked && !inputType?.startsWith('insertFromPaste')) return '';
    return getInsertedTextFromChange(previousValue, nextValue);
};

export const getFileMentionAutocompleteQuery = ({
    value,
    cursorPosition,
    inputSource = 'manual',
    insertedText,
}: {
    value: string;
    cursorPosition: number;
    inputSource?: FileMentionAutocompleteInputSource;
    insertedText?: string;
}): string | null => {
    if (inputSource === 'paste' && insertedText?.includes('@')) {
        return null;
    }

    const textBeforeCursor = value.substring(0, cursorPosition);
    const lastAtSymbol = textBeforeCursor.lastIndexOf('@');
    if (lastAtSymbol === -1) {
        return null;
    }

    const charBefore = lastAtSymbol > 0 ? textBeforeCursor[lastAtSymbol - 1] : null;
    const textAfterAt = textBeforeCursor.substring(lastAtSymbol + 1);
    const isWordBoundary = !charBefore || /\s/.test(charBefore);
    if (!isWordBoundary || textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
        return null;
    }

    return textAfterAt;
};
