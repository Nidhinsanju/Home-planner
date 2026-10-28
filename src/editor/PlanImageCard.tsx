'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Background } from '../plan/types';
import { imageSize } from './backgroundImage';
import { readAiResponse } from '../lib/aiStreamClient';
import { toast } from '../Toasts';

// Chat card for an uploaded floor plan. A newly uploaded image is sent to the vision model;
// the card then shows what it found and asks whether to build those rooms or just keep the
// drawing as reference for the chat. The choice is stored on the background, so the question
// isn't asked again. Re-read sends the image to the model again, ignoring the cached reading.

// Below this many pixels on the long side, a plan's size labels are only a few pixels tall.
const SMALL_IMAGE = 1200;

interface Props {
  background?: Background;
  planId: 'p1' | 'p2';
  onImageRead: (src: string, analysis: NonNullable<Background['analysis']>) => Promise<string[]>;
  onImageChoice: (use: 'build' | 'context') => Promise<{ message: string; notes: string[] }>;
  onMessage: (text: string) => void;
}

export function PlanImageCard({ background, planId, onImageRead, onImageChoice, onMessage }: Props) {
  const [status, setStatus] = useState<'idle' | 'reading' | 'error' | 'choosing'>('idle');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  // The image already there when the card appeared isn't read automatically, only new uploads.
  const seenSrc = useRef(background?.src);
  const src = background?.src;

  // Results arrive after an await; use the latest handlers.
  const handlers = useRef({ onImageRead, onImageChoice, onMessage });
  useEffect(() => { handlers.current = { onImageRead, onImageChoice, onMessage }; });

  const read = async (imageSrc: string, force = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('reading');
    setError('');
    try {
      const { width, height } = await imageSize(imageSrc);
      const response = await fetch('/api/plan-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ planId, image: imageSrc, width, height, force }),
        signal: controller.signal,
      });
      const res = await readAiResponse(response, st => toast(st.message, st.level));
      if (controller.signal.aborted || res.aborted) return;
      if (res.error) {
        toast(res.error, 'error');
        throw new Error(res.error);
      }
      const notes = await handlers.current.onImageRead(imageSrc, { summary: res.summary, rooms: res.rooms, extraction: res.extraction, imageWidth: res.imageWidth, imageHeight: res.imageHeight });
      notes.forEach(handlers.current.onMessage);
      setStatus('idle');
    } catch (e: any) {
      if (controller.signal.aborted) return;
      setError(e?.message || 'Could not read the image.');
      setStatus('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  useEffect(() => {
    if (!src || src === seenSrc.current) return;
    seenSrc.current = src;
    read(src);
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
  };

  const choose = async (use: 'build' | 'context') => {
    setStatus('choosing');
    const { message, notes } = await handlers.current.onImageChoice(use);
    [message, ...notes].filter(Boolean).forEach(handlers.current.onMessage);
    setStatus('idle');
  };

  if (!background) return null;
  const analysis = background.analysis;

  if (status === 'reading') {
    return (
      <Card src={background.src}>
        <p className="chat-thinking">Reading your floor plan<span>.</span><span>.</span><span>.</span></p>
        <p className="plan-card-muted">Reading every room, written size, door and window. This can take a minute.</p>
        <div className="plan-card-actions"><button onClick={cancel}>Cancel</button></div>
      </Card>
    );
  }
  if (status === 'error') {
    return (
      <Card src={background.src}>
        <p>{error}</p>
        <div className="plan-card-actions">
          <button className="primary" onClick={() => read(background.src)}>Try again</button>
          <button onClick={() => setStatus('idle')}>Dismiss</button>
        </div>
      </Card>
    );
  }
  if (!analysis) {
    return (
      <div className="plan-card-inline">
        <button onClick={() => read(background.src)}>Let AI read the floor plan</button>
      </div>
    );
  }
  const reread = (
    <div className="plan-card-inline">
      <button onClick={() => read(background.src, true)} title="Send the image to the AI again, ignoring the saved reading">Re-read floor plan</button>
    </div>
  );
  if (background.use) return reread; // already decided

  return (
    <Card src={background.src}>
      <p>{analysis.summary}</p>
      {analysis.rooms.length > 0 && (
        <div className="plan-card-rooms">
          {analysis.rooms.map((r, i) => <span key={i}>{r.name || r.type || 'Room'}</span>)}
        </div>
      )}
      {analysis.imageWidth && analysis.imageHeight && Math.max(analysis.imageWidth, analysis.imageHeight) < SMALL_IMAGE && (
        <p className="plan-card-warn">This image is small ({analysis.imageWidth} × {analysis.imageHeight} px), so written sizes are hard to read and its walls can't be traced. For the most accurate build, upload a larger copy (at least {SMALL_IMAGE} px wide).</p>
      )}
      {!analysis.extraction && !background.calibrated && analysis.rooms.length > 0 && (
        <p className="plan-card-warn">Set the scale first (Build tab → Background image → Set scale) so the rooms come out at the right size.</p>
      )}
      <p className="plan-card-muted">Should I build these rooms, or keep the drawing as reference while you design?</p>
      <div className="plan-card-actions">
        <button className="primary" disabled={status === 'choosing' || analysis.rooms.length === 0} onClick={() => choose('build')}>Build it for me</button>
        <button disabled={status === 'choosing'} onClick={() => choose('context')}>Keep as reference</button>
        <button disabled={status === 'choosing'} onClick={() => read(background.src, true)}>Re-read</button>
      </div>
    </Card>
  );
}

const Card = ({ src, children }: { src: string; children: React.ReactNode }) => (
  <div className="chat-message ai">
    <div className="chat-bubble plan-card">
      <img src={src} alt="Uploaded floor plan" />
      {children}
    </div>
  </div>
);
