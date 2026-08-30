import React from 'react';

const BAR_COUNT = 28;

export const DictationWaveform: React.FC<{
  subscribeLevel: (listener: (level: number) => void) => () => void;
  active: boolean;
}> = ({ subscribeLevel, active }) => {
  const barsRef = React.useRef<Array<HTMLSpanElement | null>>([]);
  const historyRef = React.useRef<number[]>(Array(BAR_COUNT).fill(0.05));

  React.useEffect(() => {
    if (!active) {
      historyRef.current = Array(BAR_COUNT).fill(0.05);
      for (const bar of barsRef.current) if (bar) bar.style.height = '8%';
      return;
    }
    return subscribeLevel((level) => {
      historyRef.current = [...historyRef.current.slice(1), Math.max(0.05, Math.min(1, level))];
      historyRef.current.forEach((value, index) => {
        const bar = barsRef.current[index];
        if (bar) bar.style.height = `${Math.max(8, Math.round(value * 100))}%`;
      });
    });
  }, [active, subscribeLevel]);

  return (
    <div className="flex h-12 items-center justify-center gap-1" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <span
          key={index}
          ref={(node) => { barsRef.current[index] = node; }}
          className="w-1 rounded-full bg-[var(--status-info)]/70 transition-[height] duration-75"
          style={{ height: '8%' }}
        />
      ))}
    </div>
  );
};
