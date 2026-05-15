import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
import { Icon } from "@/components/icon/Icon";
RiAddLine,
  RiArrowDownSLine,
  RiArrowRightLine,
  RiComputerLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiFlaskLine,
  RiInformationLine,
  RiPlug2Line,
  RiRefreshLine,
  RiServerLine,
  RiShuffleLine,
  RiTerminalWindowLine,
  RiDeleteBinLine,
  RiStopLine,
import {
                      <span className="typography-ui-label text-foreground truncate">{buildForwardLabel(forward)}</span>
                      <span className="typography-micro text-muted-foreground/70 shrink-0">{typeLabel}</span>
                    </CollapsibleTrigger>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={forward.enabled} onCheckedChange={(checked) => updateForward((item) => ({ ...item, enabled: checked }))} aria-label={t('settings.remoteInstances.page.actions.enableForwardAria')} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="!font-normal h-6 w-6 px-0 text-[var(--status-error)] hover:text-[var(--status-error)]"
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          portForwards: current.portForwards.filter((item) => item.id !== forward.id),
                        }))
                      }
                    >
                      <Icon name="delete-bin" className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <CollapsibleContent className="pt-2">
                  <div className="space-y-0 pb-2">
                    <p className="typography-meta text-muted-foreground mb-3">{t(forwardTypeDescriptionKey(forward.type))}</p>
                    <div className="flex flex-col gap-1.5 py-1.5 md:flex-row md:items-center md:gap-8">
                      <div className="w-56 shrink-0">
                        <HintLabel
                          label={t('settings.remoteInstances.page.field.forwardType')}
                          hint={t('settings.remoteInstances.page.field.forwardTypeHint')}
                        />
                      </div>
                      <Select
                        value={forward.type}
                        onValueChange={(value) =>
                          updateForward((item) => ({
                            ...item,
                            type: (value === 'dynamic' || value === 'remote' ? value : 'local') as DesktopSshPortForwardType,
                          }))
                        }
                      >
                        <SelectTrigger className="h-7 w-fit min-w-[140px]">
                          <SelectValue placeholder={t('settings.remoteInstances.page.field.typePlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="local">{t('settings.remoteInstances.page.forwardType.local')}</SelectItem>
                          <SelectItem value="remote">{t('settings.remoteInstances.page.forwardType.remote')}</SelectItem>
                          <SelectItem value="dynamic">{t('settings.remoteInstances.page.forwardType.dynamic')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1.5 py-1.5 md:flex-row md:items-center md:gap-8">
                      <div className="w-56 shrink-0">
                        <HintLabel label={localLabel} hint={localHint} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Input
                          className="h-7 w-32"
                          value={forward.localHost || '127.0.0.1'}
                          onChange={(event) =>
                            updateForward((item) => ({
                              ...item,
                              localHost: event.target.value,
                            }))
                          }
                          placeholder={t('settings.remoteInstances.page.field.localHostPlaceholder')}
                        />
                        <span className="text-muted-foreground">:</span>
                        <NumberInput
                          containerClassName="w-fit"
                          min={1}
                          max={65535}
                          step={1}
                          className="w-16 tabular-nums"
                          value={forward.localPort}
                          onValueChange={(next) => {
                            updateForward((item) => ({
                              ...item,
                              localPort: Number.isFinite(next) && next > 0 ? next : undefined,
                            }));
                          }}
                          onClear={() => {
                            updateForward((item) => ({
                              ...item,
                              localPort: undefined,
                            }));
                          }}
                          emptyLabel={t('settings.remoteInstances.page.field.auto')}
                        />
                      </div>
                    </div>

                    {forward.type !== 'dynamic' ? (
                      <div className="flex flex-col gap-1.5 py-1.5 md:flex-row md:items-center md:gap-8">
                        <div className="w-56 shrink-0">
                          <HintLabel label={remoteLabel} hint={remoteHint} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Input
                            className="h-7 w-32"
                            value={forward.remoteHost || ''}
                            onChange={(event) =>
                              updateForward((item) => ({
                                ...item,
                                remoteHost: event.target.value,
                              }))
                            }
                            placeholder={t('settings.remoteInstances.page.field.remoteHostPlaceholder')}
                          />
                          <span className="text-muted-foreground">:</span>
                          <NumberInput
                            containerClassName="w-fit"
                            min={1}
                            max={65535}
                            step={1}
                            className="w-16 tabular-nums"
                            value={forward.remotePort}
                            onValueChange={(next) => {
                              updateForward((item) => ({
                                ...item,
                                remotePort: Number.isFinite(next) && next > 0 ? next : undefined,
                              }));
                            }}
                            onClear={() => {
                              updateForward((item) => ({
                                ...item,
                                remotePort: undefined,
                              }));
                            }}
                            emptyLabel={t('settings.remoteInstances.page.field.auto')}
                          />
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--surface-subtle)] p-2">
                      <div className="flex flex-wrap items-center gap-1 typography-micro text-muted-foreground/80">
                        {forward.type === 'dynamic' ? (
                          <>
                            <Icon name="computer" className="h-3.5 w-3.5" />
                            <span className="font-mono text-foreground">{localEndpoint}</span>
                            <span>{t('settings.remoteInstances.page.preview.localSocks5')}</span>
                          </>
                        ) : forward.type === 'remote' ? (
                          <>
                            <Icon name="server" className="h-3.5 w-3.5" />
                            <span className="font-mono text-foreground">{remoteEndpoint}</span>
                            <span>{t('settings.remoteInstances.page.preview.remote')}</span>
                            <Icon name="arrow-right" className="h-3.5 w-3.5" />
                            <Icon name="computer" className="h-3.5 w-3.5" />
                            <span className="font-mono text-foreground">{localEndpoint}</span>
                            <span>{t('settings.remoteInstances.page.preview.local')}</span>
                          </>
                        ) : (
                          <>
                            <Icon name="computer" className="h-3.5 w-3.5" />
                            <span className="font-mono text-foreground">{localEndpoint}</span>
                            <span>{t('settings.remoteInstances.page.preview.local')}</span>
                            <Icon name="arrow-right" className="h-3.5 w-3.5" />
                            <Icon name="server" className="h-3.5 w-3.5" />
                            <span className="font-mono text-foreground">{remoteEndpoint}</span>
                            <span>{t('settings.remoteInstances.page.preview.remote')}</span>
                          </>
                        )}
                      </div>

                      {canOpenLocalEndpoint ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          className="!font-normal"
                          onClick={() => {
                            void openExternalUrl(localEndpointUrl).then((opened) => {
                              if (!opened) {
                                toast.error(t('settings.remoteInstances.page.toast.openLocalEndpointFailed'));
                              }
                            });
                          }}
                        >
                          <Icon name="external-link" className="h-3.5 w-3.5" />
                          {t('settings.remoteInstances.page.actions.openLocal')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}

          <Button
            type="button"
            variant="outline"
            size="xs"
            className="!font-normal mt-1"
            onClick={() => {
              const nextForward = makeForward();
              updateDraft((current) => ({
                ...current,
                portForwards: [...current.portForwards, nextForward],
              }));
              setExpandedForwards((current) => ({
                ...current,
                [nextForward.id]: true,
              }));
            }}
          >
            <Icon name="add" className="h-3.5 w-3.5" />
            {t('settings.remoteInstances.page.actions.addForward')}
          </Button>
        </section>
      </div>

      <div className="sticky bottom-0 z-10 -mx-3 sm:-mx-6 bg-[var(--surface-background)] border-t border-[var(--interactive-border)] px-3 sm:px-6 py-3">
        <div className="flex items-center gap-2">
          <Button type="button" size="xs" className="!font-normal" onClick={() => void handleSave()} disabled={!hasChanges || isSaving}>
            {t('settings.common.actions.saveChanges')}
          </Button>
          {status?.localUrl ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => {
                  void copyTextToClipboard(status.localUrl || '').then((result) => {
                    if (result.ok) {
                      toast.success(t('settings.remoteInstances.page.toast.localUrlCopied'));
                    }
                  });
                }}
              >
                <Icon name="file-copy" className="h-3.5 w-3.5" />
                {t('settings.remoteInstances.page.actions.copyLocalUrl')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => {
                  void handleOpenCurrentInstance();
                }}
              >
                <Icon name="external-link" className="h-3.5 w-3.5" />
                {t('settings.remoteInstances.page.actions.open')}
              </Button>
            </>
          ) : null}
          {error ? <div className="ml-auto typography-meta text-[var(--status-error)]">{error}</div> : null}
        </div>
      </div>

      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('settings.remoteInstances.page.logsDialog.title')}</DialogTitle>
            <DialogDescription>
              {draft ? resolveInstanceLabel(draft) : t('settings.remoteInstances.page.logsDialog.selectedInstanceFallback')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="xs" className="!font-normal" onClick={handleCopyAllLogs} disabled={logDialogLoading || !logLinesText.trim()}>
              <Icon name="file-copy" className="h-3.5 w-3.5" />
              {t('settings.common.actions.copyAll')}
            </Button>
            <Button type="button" variant="outline" size="xs" className="!font-normal" onClick={() => void handleClearLogs()} disabled={logDialogLoading}>
              <Icon name="delete-bin" className="h-3.5 w-3.5" />
              {t('settings.common.actions.clear')}
            </Button>
          </div>
          {logDialogLoading ? (
            <div className="typography-meta text-muted-foreground">{t('settings.remoteInstances.page.logsDialog.loading')}</div>
          ) : logDialogError ? (
            <div className="typography-meta text-[var(--status-error)]">{logDialogError}</div>
          ) : (
            <pre className="max-h-[55vh] overflow-auto rounded-md border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-3 typography-micro text-foreground whitespace-pre-wrap break-words">
              {logDialogLines.length > 0 ? logDialogLines.join('\n') : t('settings.remoteInstances.page.logsDialog.empty')}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
  );
};
