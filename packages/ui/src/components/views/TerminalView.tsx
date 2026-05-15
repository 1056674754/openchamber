import React from 'react';
import { Icon } from "@/components/icon/Icon";
                        </div>
                    </div>
                ) : null}

                {!isMobile && showQuickKeys && enableTabs && directoryTerminalState ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1 pl-1 pr-1">
                        {quickKeysControls}
                    </div>
                ) : null}

                {showQuickKeys && (isMobile || !enableTabs || !directoryTerminalState) ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                        {quickKeysControls}
                    </div>
                ) : null}
            </div>

            <div
                className="relative flex-1 overflow-hidden"
                style={{ backgroundColor: xtermTheme.background }}
            >
                <div className="h-full w-full box-border pl-4 pr-1.5 pt-3 pb-4">
                    {shouldRenderViewport ? (
                        <TerminalViewport
                            ref={(controller) => {
                                terminalControllerRef.current = controller;
                            }}
                            sessionKey={terminalViewportKey}
                            chunks={bufferChunks}
                            onInput={handleViewportInput}
                            onResize={handleViewportResize}
                            theme={xtermTheme}
                            fontFamily={resolvedFontStack}
                            fontSize={terminalFontSize}
                            enableTouchScroll={useTouchTerminalInput}
                            autoFocus={!useTouchTerminalInput && isTerminalVisible}
                            isVisible={isTerminalVisible}
                        />
                    ) : null}
                </div>
                {!isReconnectPending && connectionError && (
                    <div className="absolute inset-x-0 bottom-0 bg-[var(--status-error-background)] px-3 py-2 text-xs text-[var(--status-error-foreground)] flex items-center justify-between gap-2">
                        <span>{connectionError}</span>
                        {isFatalError && isMobile && (
                            <Button
                                size="sm"
                                variant="secondary"
                                className="h-6 px-2 py-0 text-xs"
                                onClick={handleHardRestart}
                                disabled={isRestarting}
                                title={t('terminalView.actions.hardRestartTitle')}
                                type="button"
                            >
                                {t('terminalView.actions.hardRestart')}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
