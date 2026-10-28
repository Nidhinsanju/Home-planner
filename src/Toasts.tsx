'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

// Small notices in the corner of the screen, e.g. "AI model 1 of 4 is busy, trying the next
// one…" while an AI request runs. Call toast() from anywhere in the browser; <Toaster /> (once,
// in the app) shows them. The same message again replaces the older copy instead of stacking.
export type ToastLevel = 'info' | 'warning' | 'error';
type Toast = { id: number; level: ToastLevel; message: string };

const listeners = new Set<(t: Toast) => void>();
let nextId = 1;

export function toast(message: string, level: ToastLevel = 'info') {
  if (!message) return;
  const t = { id: nextId++, level, message };
  listeners.forEach(l => l(t));
}

const MAX_SHOWN = 4;
const SHOWN_MS: Record<ToastLevel, number> = { info: 4000, warning: 5000, error: 8000 };

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const all = timers.current;
    const show = (t: Toast) => {
      setToasts(prev => [...prev.filter(p => p.message !== t.message), t].slice(-MAX_SHOWN));
      all.set(t.id, setTimeout(() => dismiss(t.id), SHOWN_MS[t.level]));
    };
    listeners.add(show);
    return () => {
      listeners.delete(show);
      all.forEach(clearTimeout);
      all.clear();
    };
  }, [dismiss]);

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.level}`}>
          <span>{t.message}</span>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}
