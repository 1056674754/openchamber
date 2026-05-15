import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import {
  RiCheckLine,
  RiCheckboxMultipleLine,
  RiChatNewLine,
  RiEqualizer2Line,
  RiFolderAddLine,
  RiGlobeLine,
  RiLayoutLeftLine,
  RiRefreshLine,
  RiSearchLine,
  RiCloseLine,
  RiContractUpDownLine,
  RiExpandUpDownLine,
  RiCalendarScheduleLine,
  RiFolderLine,

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={openMultiRunLauncher}
                    className={headerActionButtonClass}
                    aria-label={t('sessions.sidebar.header.actions.newMultiRun')}
                    disabled={!canOpenMultiRun}
                  >
                    <Icon name="arrows-merge" className={headerActionIconClass} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}><p>{t('sessions.sidebar.header.actions.newMultiRun')}</p></TooltipContent>
              </Tooltip>
            </div>

            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={openScheduledTasksDialog}
                    className={headerActionButtonClass}
                    aria-label={t('sessions.sidebar.header.actions.scheduledTasks')}
                  >
                    <Icon name="calendar-schedule" className={headerActionIconClass} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}><p>{t('sessions.sidebar.header.actions.scheduledTasks')}</p></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setIsSessionSearchOpen((prev) => !prev)}
                    className={headerActionButtonClass}
                    aria-label={t('sessions.sidebar.header.actions.searchSessions')}
                    aria-expanded={isSessionSearchOpen}
                  >
                    <Icon name="search" className={headerActionIconClass} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}><p>{t('sessions.sidebar.header.actions.searchSessions')}</p></TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onToggleSelectionMode}
                    className={cn(headerActionButtonClass, selectionModeEnabled && 'bg-interactive-hover text-primary')}
                    aria-label={selectionModeEnabled
                      ? t('sessions.sidebar.header.actions.exitSelection')
                      : t('sessions.sidebar.header.actions.selectSessions')}
                    aria-pressed={selectionModeEnabled}
                  >
                    <Icon name="checkbox-multiple" className={headerActionIconClass} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  <p>{selectionModeEnabled
                    ? t('sessions.sidebar.header.actions.exitSelection')
                    : t('sessions.sidebar.header.actions.selectSessions')}</p>
                </TooltipContent>
              </Tooltip>

              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={headerActionButtonClass}
                        aria-label={t('sessions.sidebar.header.actions.sessionDisplayMode')}
                      >
                        <Icon name="equalizer-2" className={headerActionIconClass} />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={4}><p>{t('sessions.sidebar.header.displayMode.label')}</p></TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem
                    onClick={() => setDisplayMode('default')}
                    className="flex items-center justify-between"
                  >
                    <span>{t('sessions.sidebar.header.displayMode.default')}</span>
                    {displayMode === 'default' ? <Icon name="check" className="h-4 w-4 text-primary" /> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setDisplayMode('minimal')}
                    className="flex items-center justify-between"
                  >
                    <span>{t('sessions.sidebar.header.displayMode.minimal')}</span>
                    {displayMode === 'minimal' ? <Icon name="check" className="h-4 w-4 text-primary" /> : null}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={toggleRecentSection}
                    className="flex items-center justify-between"
                  >
                    <span>{t('sessions.sidebar.header.displayMode.showRecent')}</span>
                    {showRecentSection ? <Icon name="check" className="h-4 w-4 text-primary" /> : null}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={collapseAllProjects} className="flex items-center gap-2">
                    <Icon name="contract-up-down" className="h-4 w-4" />
                    <span>{t('sessions.sidebar.header.displayMode.collapseAll')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={expandAllProjects} className="flex items-center gap-2">
                    <Icon name="expand-up-down" className="h-4 w-4" />
                    <span>{t('sessions.sidebar.header.displayMode.expandAll')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {isSessionSearchOpen ? (
            <div className="pb-1">
              <div className="mb-1 flex items-center justify-between px-0.5 typography-micro text-muted-foreground/80">
                {hasSessionSearchQuery ? (
                  <span>{searchMatchCount === 1
                    ? t('sessions.sidebar.header.search.matchCountSingle', { count: searchMatchCount })
                    : t('sessions.sidebar.header.search.matchCountPlural', { count: searchMatchCount })}</span>
                ) : <span />}
                <span>{t('sessions.sidebar.header.search.escapeHint')}</span>
              </div>
              <div className="relative">
                <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={sessionSearchInputRef}
                  value={sessionSearchQuery}
                  onChange={(event) => setSessionSearchQuery(event.target.value)}
                  placeholder={t('sessions.sidebar.header.search.placeholder')}
                  className="h-8 w-full rounded-md border border-border bg-transparent pl-8 pr-8 typography-ui-label text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      if (hasSessionSearchQuery) {
                        setSessionSearchQuery('');
                      } else {
                        setIsSessionSearchOpen(false);
                      }
                    }
                  }}
                />
                {sessionSearchQuery.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSessionSearchQuery('')}
                    className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    aria-label={t('sessions.sidebar.header.search.clear')}
                  >
                    <Icon name="close" className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
