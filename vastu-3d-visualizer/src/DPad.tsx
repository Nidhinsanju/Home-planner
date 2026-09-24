import React from 'react';

export const DPad = ({ onPan }: { onPan: (dir: string, active: boolean) => void }) => {
  const bind = (dir: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); onPan(dir, true); },
    onPointerUp: () => onPan(dir, false),
    onPointerLeave: () => onPan(dir, false),
  });

  return (
    <div className="dpad">
      <button className="dpad-btn dpad-up" {...bind('up')}>▲</button>
      <button className="dpad-btn dpad-left" {...bind('left')}>◀</button>
      <button className="dpad-btn dpad-right" {...bind('right')}>▶</button>
      <button className="dpad-btn dpad-down" {...bind('down')}>▼</button>
      <div className="dpad-center"></div>
    </div>
  );
};
