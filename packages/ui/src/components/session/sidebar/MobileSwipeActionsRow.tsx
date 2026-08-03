import React from 'react';

import {
  clampMobileSwipeOffset,
  shouldRevealMobileSwipeActions,
} from './mobileSwipeActions';

const HORIZONTAL_INTENT_PX = 6;

type MobileSwipeActionsRowProps = {
  readonly enabled: boolean;
  readonly actionsWidth: number;
  readonly actions: React.ReactNode;
  readonly children: React.ReactNode;
};

type PointerOrigin = {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly offset: number;
};

export const MobileSwipeActionsRow: React.FC<MobileSwipeActionsRowProps> = ({
  enabled,
  actionsWidth,
  actions,
  children,
}) => {
  const [revealed, setRevealed] = React.useState(false);
  const [dragOffset, setDragOffset] = React.useState<number | null>(null);
  const pointerOriginRef = React.useRef<PointerOrigin | null>(null);
  const horizontalIntentRef = React.useRef(false);
  const suppressClickRef = React.useRef(false);
  const settledOffset = revealed ? -actionsWidth : 0;
  const offset = dragOffset ?? settledOffset;

  if (!enabled) return children;

  return (
    <div className="relative overflow-hidden rounded-sm">
      <div className="absolute inset-y-0 right-0 flex" style={{ width: actionsWidth }}>
        {actions}
      </div>
      <div
        style={{
          transform: `translate3d(${offset}px,0,0)`,
          transition: dragOffset === null ? 'transform 180ms ease-out' : 'none',
          touchAction: 'pan-y',
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch') return;
          pointerOriginRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            offset: settledOffset,
          };
          horizontalIntentRef.current = false;
          suppressClickRef.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const origin = pointerOriginRef.current;
          if (!origin || origin.pointerId !== event.pointerId) return;
          const deltaX = event.clientX - origin.x;
          const deltaY = event.clientY - origin.y;
          if (!horizontalIntentRef.current) {
            if (Math.abs(deltaX) < HORIZONTAL_INTENT_PX) return;
            if (Math.abs(deltaY) >= Math.abs(deltaX)) return;
            horizontalIntentRef.current = true;
          }
          event.preventDefault();
          suppressClickRef.current = true;
          setDragOffset(clampMobileSwipeOffset(origin.offset + deltaX, actionsWidth));
        }}
        onPointerUp={(event) => {
          const origin = pointerOriginRef.current;
          if (!origin || origin.pointerId !== event.pointerId) return;
          const nextOffset = dragOffset ?? origin.offset;
          if (horizontalIntentRef.current) {
            setRevealed(shouldRevealMobileSwipeActions(nextOffset, actionsWidth));
          }
          setDragOffset(null);
          pointerOriginRef.current = null;
          horizontalIntentRef.current = false;
        }}
        onPointerCancel={() => {
          setDragOffset(null);
          pointerOriginRef.current = null;
          horizontalIntentRef.current = false;
        }}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return;
          suppressClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
};
