import React, { memo } from 'react';
import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    sortableKeyboardCoordinates,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMessageQueueStore, type QueuedMessage } from '@/stores/messageQueueStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useInputStore } from '@/sync/input-store';
import { useI18n } from '@/lib/i18n';
import { Icon } from "@/components/icon/Icon";
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ComposerFloatingPanel } from './composer/ui/ComposerFloatingPanel';
import { useMobileAutocompleteMaxHeight } from './useMobileAutocompleteMaxHeight';

interface QueuedMessageChipProps {
    message: QueuedMessage;
    sessionId: string;
    onEdit: (message: QueuedMessage) => void;
    onSend: (message: QueuedMessage) => void;
}

const QueuedMessageChip = memo(({ message, sessionId, onEdit, onSend }: QueuedMessageChipProps) => {
    const { t } = useI18n();
    const removeFromQueue = useMessageQueueStore((state) => state.removeFromQueue);
    const {
        attributes,
        listeners,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: message.id });

    const firstLine = React.useMemo(() => {
        const lines = message.content.split('\n');
        const first = lines[0] || '';
        const maxLength = 100;
        if (first.length > maxLength) {
            return first.substring(0, maxLength) + '...';
        }
        return first + (lines.length > 1 ? '...' : '');
    }, [message.content]);

    const attachmentCount = message.attachments?.length ?? 0;

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Translate.toString(transform), transition }}
            className={cn('flex min-w-0 items-center gap-2 py-1', isDragging && 'z-10 opacity-60')}
        >
            <Button
                ref={setActivatorNodeRef}
                type="button"
                variant="ghost"
                size="xs"
                {...attributes}
                {...listeners}
                className="cursor-grab touch-none select-none text-muted-foreground active:cursor-grabbing"
                aria-label={t('chat.queuedMessage.reorderAria')}
            >
                <Icon name="draggable" className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="min-w-0 flex-1 truncate typography-ui-label text-foreground">
                {firstLine || t('chat.queuedMessage.empty')}
                {attachmentCount > 0 && (
                    <span className="ml-1 text-muted-foreground">{t('chat.queuedMessage.attachments', { count: attachmentCount })}</span>
                )}
            </span>
            <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => onEdit(message)}
            >
                <Icon name="edit" className="h-3 w-3" aria-hidden="true" />
                {t('chat.queuedMessage.edit')}
            </Button>
            <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => onSend(message)}
            >
                <Icon name="send-plane" className="h-3 w-3" aria-hidden="true" />
                {t('chat.queuedMessage.send')}
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => removeFromQueue(sessionId, message.id)}
                aria-label={t('chat.queuedMessage.removeAria')}
            >
                <Icon name="close" className="h-4 w-4 text-muted-foreground" />
            </Button>
        </div>
    );
});

QueuedMessageChip.displayName = 'QueuedMessageChip';

interface QueuedMessageChipsProps {
    /** Another floating panel (btw) owns the slot — the queue stays mounted but hidden. */
    hidden?: boolean;
    onEditMessage: (content: string, attachments?: QueuedMessage['attachments']) => void;
    onSendMessage: (messageId: string) => void;
}

const EMPTY_QUEUE: QueuedMessage[] = [];

export const QueuedMessageChips = memo(({ hidden = false, onEditMessage, onSendMessage }: QueuedMessageChipsProps) => {
    const { t } = useI18n();
    const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
    // Collapse is local to the mounted session queue and survives temporary
    // hiding behind btw; switching queue identity resets it.
    const [collapsed, setCollapsed] = React.useState(false);
    const [collapseSessionId, setCollapseSessionId] = React.useState(currentSessionId);
    if (collapseSessionId !== currentSessionId) {
        setCollapseSessionId(currentSessionId);
        setCollapsed(false);
    }
    const bodyId = React.useId();
    const bodyRef = React.useRef<HTMLDivElement | null>(null);
    const queuedMessages = useMessageQueueStore(
        React.useCallback(
            (state) => {
                if (!currentSessionId) return EMPTY_QUEUE;
                // A message already being delivered leaves the editable queue.
                const queue = state.queuedMessages[currentSessionId] ?? EMPTY_QUEUE;
                const sending = state.sendingIds[currentSessionId];
                if (!sending || sending.length === 0) return queue;
                return queue.filter((message) => !sending.includes(message.id));
            },
            [currentSessionId]
        )
    );
    const popToInput = useMessageQueueStore((state) => state.popToInput);
    const reorderQueue = useMessageQueueStore((state) => state.reorderQueue);
    const availableMaxHeight = useMobileAutocompleteMaxHeight(bodyRef, !hidden && !collapsed && queuedMessages.length > 0, 168 + 48);
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragEnd = React.useCallback((event: DragEndEvent) => {
        if (!currentSessionId || !event.over || event.active.id === event.over.id) return;
        reorderQueue(currentSessionId, String(event.active.id), String(event.over.id));
    }, [currentSessionId, reorderQueue]);

    const handleEdit = React.useCallback((message: QueuedMessage) => {
        if (!currentSessionId) return;

        void popToInput(currentSessionId, message.id).then((popped) => {
            if (popped) {
                if (popped.attachments && popped.attachments.length > 0) {
                    const currentAttachments = useInputStore.getState().attachedFiles;
                    useInputStore.getState().setAttachedFiles([...currentAttachments, ...popped.attachments]);
                }
                onEditMessage(popped.content, popped.attachments);
            }
        });
    }, [currentSessionId, popToInput, onEditMessage]);

    const handleSend = React.useCallback((message: QueuedMessage) => {
        onSendMessage(message.id);
    }, [onSendMessage]);

    if (hidden || queuedMessages.length === 0 || !currentSessionId) {
        return null;
    }

    return (
        <ComposerFloatingPanel role="region" ariaLabel={t('chat.queuedMessage.title')} compact={collapsed} header={
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCollapsed((value) => !value)}
                    aria-expanded={!collapsed}
                    aria-controls={collapsed ? undefined : bodyId}
                    className="min-w-0 flex-1 shrink justify-start px-0 normal-case text-muted-foreground hover:!bg-transparent hover:text-foreground has-[>svg]:px-0"
                >
                    <Icon name="time" className="size-3.5 shrink-0" aria-hidden="true" />
                    <Icon name={collapsed ? 'arrow-up-s' : 'arrow-down-s'} className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{t('chat.queuedMessage.title')} {queuedMessages.length}</span>
                </Button>
        }>
            {!collapsed && (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext
                        items={queuedMessages.map((message) => message.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div
                            ref={bodyRef}
                            id={bodyId}
                            className="px-3 pb-3 flex flex-col gap-1.5 max-h-[10.5rem] overflow-y-auto overscroll-contain"
                            style={availableMaxHeight === undefined ? undefined : { maxHeight: Math.max(72, availableMaxHeight - 48) }}
                        >
                            {queuedMessages.map((message) => (
                                <QueuedMessageChip
                                    key={message.id}
                                    message={message}
                                    sessionId={currentSessionId}
                                    onEdit={handleEdit}
                                    onSend={handleSend}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}
        </ComposerFloatingPanel>
    );
});

QueuedMessageChips.displayName = 'QueuedMessageChips';
