type AssistantMessageVisibility = {
    readonly hasRenderableContent: boolean;
    readonly hasError: boolean;
    readonly isDirectiveBanner?: boolean;
};

export const shouldHideAssistantMessageShell = ({
    hasRenderableContent,
    hasError,
    isDirectiveBanner = false,
}: AssistantMessageVisibility): boolean => !isDirectiveBanner && !hasRenderableContent && !hasError;
