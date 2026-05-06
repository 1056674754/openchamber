import React from 'react';

const DOT_SIZE = 3;
const DOT_STEP = 4;
const BOX_SIZE = 16;

const CORNERS = new Set([0, 3, 12, 15]);
const OUTER_RING = new Set([1, 2, 4, 7, 8, 11, 13, 14]);

const DOTS = Array.from({ length: 16 }, (_, index) => ({
  index,
  row: Math.floor(index / 4),
  col: index % 4,
  delay: ((index * 37) % 17) / 10,
  duration: 1 + (((index * 19) % 11) / 10),
}));

type SpinnerState = 'streaming' | 'subagent' | 'hidden';

interface SidebarSpinnerProps {
  state: SpinnerState;
  'aria-label'?: string;
}

export function SidebarSpinner({ state, 'aria-label': ariaLabel }: SidebarSpinnerProps) {
  if (state === 'hidden') return null;

  const dotColor = state === 'streaming' ? 'var(--primary)' : state === 'subagent' ? 'var(--status-warning)' : 'var(--foreground)';

  return (
    <span
      aria-label={ariaLabel}
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexShrink: 0,
        width: BOX_SIZE,
        height: BOX_SIZE,
      }}
    >
      {DOTS.map((dot) => {
        const hidden = CORNERS.has(dot.index);
        const outer = OUTER_RING.has(dot.index);

        return (
        <span
          key={dot.index}
          style={{
            position: 'absolute',
            left: dot.col * DOT_STEP,
            top: dot.row * DOT_STEP,
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: 1,
            backgroundColor: dotColor,
            opacity: hidden ? 0 : undefined,
            animation: hidden ? undefined : `${outer ? 'pulse-opacity-dim' : 'pulse-opacity'} ${dot.duration}s ease-in-out infinite`,
            animationDelay: hidden ? undefined : `${dot.delay}s`,
            animationFillMode: hidden ? undefined : 'both',
          }}
        />
        );
      })}
    </span>
  );
}
