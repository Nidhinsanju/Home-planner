'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Timing helpers for the editor: debounce (wait until the user pauses) and throttle (at most
// once per animation frame). The returned functions keep the same identity across renders
// and always call the latest `fn`, so they are safe to pass to memoised children; anything
// still pending is cancelled when the component unmounts.

type Timed<A extends unknown[]> = ((...args: A) => void) & { flush: () => void; cancel: () => void };

// Calls `fn` once the calls have stopped for `ms` milliseconds, with the last arguments.
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms: number): Timed<A> {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<A | null>(null);

  const debounced = useMemo(() => {
    const flush = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const args = pending.current;
      pending.current = null;
      if (args) fnRef.current(...args);
    };
    const cancel = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
    };
    const run = (...args: A) => {
      pending.current = args;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, ms);
    };
    return Object.assign(run, { flush, cancel });
  }, [ms]);

  useEffect(() => debounced.cancel, [debounced]);
  return debounced;
}

// Calls `fn` at most once per animation frame, with the latest arguments of that frame.
// Pointer and wheel events can fire several times per frame (high-rate mice); this does the
// work once per frame instead. `flush` runs a pending call now (e.g. on pointer up).
export function useRafThrottle<A extends unknown[]>(fn: (...args: A) => void): Timed<A> {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  const frame = useRef<number | null>(null);
  const pending = useRef<A | null>(null);

  const throttled = useMemo(() => {
    const flush = () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
      const args = pending.current;
      pending.current = null;
      if (args) fnRef.current(...args);
    };
    const cancel = () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current = null;
    };
    const run = (...args: A) => {
      pending.current = args;
      if (frame.current == null) frame.current = requestAnimationFrame(flush);
    };
    return Object.assign(run, { flush, cancel });
  }, []);

  useEffect(() => throttled.cancel, [throttled]);
  return throttled;
}

// `value`, updated only after it has stopped changing for `ms` milliseconds.
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

// A function that runs `fn` at most once every `ms` milliseconds: the first call at once, and
// the last call of each window when it ends, so the final value is never lost. For values
// read every frame, such as the 3D camera angle.
export function useThrottledCallback<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  const last = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<A | null>(null);
  useEffect(() => () => { if (trailing.current) clearTimeout(trailing.current); }, []);
  return useCallback((...args: A) => {
    const wait = ms - (performance.now() - last.current);
    if (wait <= 0) {
      last.current = performance.now();
      fnRef.current(...args);
      return;
    }
    pending.current = args;
    if (trailing.current) return;
    trailing.current = setTimeout(() => {
      trailing.current = null;
      last.current = performance.now();
      const a = pending.current;
      pending.current = null;
      if (a) fnRef.current(...a);
    }, wait);
  }, [ms]);
}
