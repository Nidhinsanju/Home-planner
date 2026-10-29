import React, { useState } from 'react';
import {
  Undo2, Redo2, Layers, Box, Bookmark, Trash2, ChevronDown, LogOut,
  Home, LayoutGrid, Settings, LayoutTemplate, Upload, Sun,
  Sparkles, Send, Compass as CompassIcon
} from 'lucide-react';
import { getChatHistory, clearChatHistory, saveChatTurn } from './actions/chat';
import type { Background } from './plan/types';
import type { SetPlanPayload } from './plan/setPlan';
import { PlanImageCard } from './editor/PlanImageCard';
import { looksLikePlan, parseJsonText } from './plan/importPlan';
import { readAiResponse } from './lib/aiStreamClient';
import { toast } from './Toasts';
import { aiHeaders } from './lib/deviceHints';

export const NavRail = ({
  activeNav = 'plans',
  onSelectNav,
}: {
  activeNav?: 'plans' | 'vastu' | 'settings' | 'templates' | 'export';
  onSelectNav?: (nav: 'plans' | 'vastu' | 'settings' | 'templates' | 'export') => void;
}) => {
  return (
    <aside className="nav-rail">
      <div className="nav-rail-top">
        <button
          className="nav-logo-btn"
          title="AI-Home Planner"
          onClick={() => onSelectNav?.('plans')}
        >
          <Home size={22} />
        </button>
      </div>

      <nav className="nav-rail-items">
        <button
          className={`nav-item-btn ${activeNav === 'plans' ? 'active' : ''}`}
          onClick={() => onSelectNav?.('plans')}
          title="Plans"
        >
          <div className="nav-item-icon-box">
            <LayoutGrid size={20} />
          </div>
          <span className="nav-item-label">Plans</span>
        </button>

        <button
          className={`nav-item-btn ${activeNav === 'vastu' ? 'active' : ''}`}
          onClick={() => onSelectNav?.('vastu')}
          title="Vastu report"
        >
          <div className="nav-item-icon-box">
            <CompassIcon size={20} />
          </div>
          <span className="nav-item-label">Vastu</span>
        </button>

        <button
          className={`nav-item-btn ${activeNav === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectNav?.('settings')}
          title="Settings"
        >
          <div className="nav-item-icon-box">
            <Settings size={20} />
          </div>
          <span className="nav-item-label">Settings</span>
        </button>

        <button
          className={`nav-item-btn ${activeNav === 'templates' ? 'active' : ''}`}
          onClick={() => onSelectNav?.('templates')}
          title="Templates"
        >
          <div className="nav-item-icon-box">
            <LayoutTemplate size={20} />
          </div>
          <span className="nav-item-label">Templates</span>
        </button>

        <button
          className={`nav-item-btn ${activeNav === 'export' ? 'active' : ''}`}
          onClick={() => onSelectNav?.('export')}
          title="Export"
        >
          <div className="nav-item-icon-box">
            <Upload size={20} />
          </div>
          <span className="nav-item-label">Export</span>
        </button>
      </nav>

      <div className="nav-rail-bottom">
        <button className="nav-theme-btn" title="Toggle theme">
          <Sun size={20} />
        </button>
      </div>
    </aside>
  );
};

export const TopBar = ({
  view, setView,
  onUndo, canUndo,
  onRedo, canRedo,
  unit, setUnit,
  onSave, dirty,
  onRemovePlan,
  onLogout,
  username,
  cutaway, setCutaway
}: any) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const displayName = username || 'Nidhin Sanju';
  const initial = displayName.trim()[0]?.toUpperCase() || 'N';

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <div className="top-bar-brand">
          <span className="brand-title">AI-Home Planner</span>
          <div className="brand-user-meta">
            <span className="brand-welcome">Welcome, {displayName} 👋</span>
            <span className="brand-tagline">Design • Plan • Visualize • Build</span>
          </div>
        </div>
      </div>

      <div className="top-bar-right">
        <button
          className="top-bar-icon-btn"
          onClick={onUndo}
          disabled={!canUndo}
          style={{ opacity: canUndo ? 1 : 0.4 }}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={18} />
        </button>

        <button
          className="top-bar-icon-btn"
          onClick={onRedo}
          disabled={!canRedo}
          style={{ opacity: canRedo ? 1 : 0.4 }}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={18} />
        </button>

        <button
          className="top-bar-unit-btn"
          onClick={() => setUnit(unit === 'ft' ? 'mt' : 'ft')}
          title="Toggle Unit"
        >
          Unit: {unit === 'ft' ? 'ft' : 'm'} <span className="caret">▾</span>
        </button>

        <div className="top-bar-view-seg">
          <button
            className={`view-seg-btn ${view === '2d' ? 'active' : ''}`}
            onClick={() => setView('2d')}
          >
            <Layers size={15} />
            <span>2D Plan</span>
          </button>
          <button
            className={`view-seg-btn ${view === '3d' ? 'active' : ''}`}
            onClick={() => setView('3d')}
          >
            <Box size={15} />
            <span>3D View</span>
          </button>
        </div>

        {view === '3d' && setCutaway && (
          <button
            className="top-bar-pill-btn"
            onClick={() => setCutaway(!cutaway)}
            title="Show low walls so you can see inside rooms"
          >
            Cutaway: {cutaway ? 'On' : 'Off'}
          </button>
        )}

        {onSave && (
          <button className="top-bar-save-btn" onClick={onSave} title="Save (Ctrl+S)">
            <Bookmark size={15} />
            <span>Save{dirty ? ' •' : ''}</span>
          </button>
        )}

        {onRemovePlan && (
          <button
            className="top-bar-remove-btn"
            onClick={onRemovePlan}
            title="Delete everything on this plan"
          >
            <Trash2 size={15} />
            <span>Remove Plan</span>
          </button>
        )}

        <div className="user-avatar-wrapper" style={{ position: 'relative' }}>
          <button
            className="user-avatar-btn"
            onClick={() => setShowUserMenu(!showUserMenu)}
            title={`Account: ${displayName}`}
          >
            <span className="user-avatar-circle">{initial}</span>
            <ChevronDown size={14} className="user-avatar-caret" />
          </button>

          {showUserMenu && (
            <div className="user-dropdown-menu">
              <div className="user-dropdown-header">Signed in as {displayName}</div>
              {onLogout && (
                <button
                  className="user-dropdown-item"
                  onClick={() => { setShowUserMenu(false); onLogout(); }}
                >
                  <LogOut size={14} /> Log out
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const Compass: React.FC<{ rotation?: number }> = ({ rotation = 0 }) => {
  return (
    <div className="canvas-compass">
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: `rotate(${rotation}rad)` }}>
        <defs>
          <radialGradient id="compass-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="85%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#e2e8f0" />
          </radialGradient>
        </defs>
        {/* Outer Ring */}
        <circle cx="50" cy="50" r="46" fill="url(#compass-bg)" stroke="#e2e8f0" strokeWidth="2" />
        <circle cx="50" cy="50" r="41" fill="none" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="1.5 2.5" />
        {/* Cardinal Lines */}
        <line x1="50" y1="14" x2="50" y2="86" stroke="#e2e8f0" strokeWidth="1" />
        <line x1="14" y1="50" x2="86" y2="50" stroke="#e2e8f0" strokeWidth="1" />
        {/* Needle North */}
        <polygon points="50,13 54,50 50,50" fill="#dc2626" />
        <polygon points="50,13 46,50 50,50" fill="#ef4444" />
        {/* Needle South */}
        <polygon points="50,87 54,50 50,50" fill="#1e293b" />
        <polygon points="50,87 46,50 50,50" fill="#334155" />
        {/* Center Pivot */}
        <circle cx="50" cy="50" r="4.5" fill="#0f172a" />
        <circle cx="50" cy="50" r="2" fill="#ffffff" />
        {/* Labels */}
        <text x="50" y="27" fill="#ef4444" fontSize="13" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">N</text>
        <text x="50" y="81" fill="#334155" fontSize="13" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">S</text>
        <text x="81" y="54" fill="#64748b" fontSize="12" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">E</text>
        <text x="19" y="54" fill="#64748b" fontSize="12" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle">W</text>
      </svg>
    </div>
  );
};

// `missingTarget`: the AI tried to change something that isn't on the plan, so nothing was done.
export type AiChange = { changed: boolean; summary: string; notes: string[]; missingTarget?: boolean };

// Memoised: it only re-renders when the plan, the image or its handlers change.
export const ChatSidebar = React.memo(function ChatSidebar({
  onBuildCommands,
  onSetPlan,
  activePlanIndex,
  sceneData,
  background,
  onImageRead,
  onImageChoice,
  onImportPlan,
  queuedPrompt,
  chatNote,
}: {
  onImportPlan?: (text: string) => Promise<{ message: string; notes: string[] }>;
  // A message sent on the user's behalf from elsewhere in the app (e.g. "Explain with AI").
  queuedPrompt?: { id: number; text: string };
  // Lines posted to the chat by the app (e.g. what Fix with AI changed), once each.
  chatNote?: { id: number; lines: string[] };
  onBuildCommands?: (cmds: any[]) => Promise<AiChange>;
  onSetPlan?: (payload: SetPlanPayload) => Promise<AiChange>;
  activePlanIndex: number;
  sceneData?: any;
  background?: Background;
  onImageRead: React.ComponentProps<typeof PlanImageCard>['onImageRead'];
  onImageChoice: React.ComponentProps<typeof PlanImageCard>['onImageChoice'];
}) {
  // `retry`: the request to send again from a "Try again" button (when the AI was busy or unreachable).
  const [messages, setMessages] = React.useState<{ text: string; isAi: boolean; time?: string; retry?: string; busy?: boolean }[]>([
    { text: "Hello! I am your AI assistant. How can I help you design your home today?", isAi: true, time: "10:20 AM" }
  ]);
  const [input, setInput] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  const onBuildCommandsRef = React.useRef(onBuildCommands);
  const onSetPlanRef = React.useRef(onSetPlan);
  const activePlanRef = React.useRef(activePlanIndex);
  const imageRef = React.useRef(background?.src);

  React.useEffect(() => {
    onBuildCommandsRef.current = onBuildCommands;
    onSetPlanRef.current = onSetPlan;
    activePlanRef.current = activePlanIndex;
    imageRef.current = background?.src;
  });

  const getNowTime = () => {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  React.useEffect(() => {
    const token = localStorage.getItem('token');
    const planId = activePlanIndex === 0 ? 'p1' : activePlanIndex === 1 ? 'p2' : 'example';
    let cancelled = false;

    setMessages([
      { text: "Hello! I am your AI assistant. How can I help you design your home today?", isAi: true, time: getNowTime() }
    ]);

    if (token && planId !== 'example') {
      getChatHistory(token, planId).then((res) => {
        if (cancelled) return;
        if (res.messages && res.messages.length > 0) {
          const loadedMsgs = res.messages.map((m: any) => ({
            text: m.content,
            isAi: m.role === 'assistant',
            time: getNowTime()
          }));
          setMessages([
            { text: "Hello! I am your AI assistant. How can I help you design your home today?", isAi: true, time: "10:20 AM" },
            ...loadedMsgs
          ]);
        }
      });
    }
    return () => { cancelled = true; };
  }, [activePlanIndex]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    setIsLoading(false);
  }, [activePlanIndex]);

  const handleStop = () => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    setIsLoading(false);
    const done = stepsDoneRef.current;
    setMessages(prev => [
      ...prev,
      {
        text: done ? `Stopped. The ${done} step${done > 1 ? "s" : ""} already done stay on the plan (use Undo to remove them).` : "Stopped. No changes were made.",
        isAi: true,
        time: getNowTime()
      }
    ]);
  };

  const sceneDataRef = React.useRef(sceneData);
  React.useEffect(() => { sceneDataRef.current = sceneData; });

  const nextScene = async (prev: unknown) => {
    for (let i = 0; i < 60 && sceneDataRef.current === prev; i++) await new Promise(r => setTimeout(r, 16));
  };

  const applyNow = async (apply: () => Promise<AiChange> | undefined): Promise<AiChange> => {
    const before = sceneDataRef.current;
    const res = (await apply()) || { changed: false, summary: '', notes: [] };
    if (res.changed) await nextScene(before);
    return res;
  };

  const applyCommandsNow = (cmds: any[]) => applyNow(() => onBuildCommandsRef.current?.(cmds));
  const stepsDoneRef = React.useRef(0);

  const say = (text: string, extra?: { retry?: string; busy?: boolean }) => setMessages(prev => [...prev, { text, isAi: true, time: getNowTime(), ...extra }]);

  // Sends a failed request again; its button goes away so it is pressed once.
  const retry = (idx: number, prompt: string) => {
    if (isLoading) return;
    setMessages(prev => prev.map((m, i) => (i === idx ? { ...m, retry: undefined } : m)));
    run(prompt);
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { text: userMsg, isAi: false, time: getNowTime() }]);
    setInput('');
    // A floor plan pasted as JSON (e.g. written by another AI) is built straight away.
    const raw = onImportPlan && userMsg.includes('{') ? parseJsonText(userMsg) : null;
    if (raw && looksLikePlan(raw)) {
      setIsLoading(true);
      onImportPlan!(userMsg)
        .then(({ message, notes }) => [message, ...notes].filter(Boolean).forEach(t => say(t)))
        .finally(() => setIsLoading(false));
      return;
    }
    run(userMsg);
  };

  const lastNote = React.useRef(chatNote?.id);
  React.useEffect(() => {
    if (!chatNote || chatNote.id === lastNote.current) return;
    lastNote.current = chatNote.id;
    setMessages(prev => [...prev, ...chatNote.lines.map(text => ({ text, isAi: true, time: getNowTime() }))]);
  }, [chatNote]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prompts queued from elsewhere are sent as if typed (once each).
  const lastQueued = React.useRef(queuedPrompt?.id);
  React.useEffect(() => {
    if (!queuedPrompt || queuedPrompt.id === lastQueued.current || isLoading) return;
    lastQueued.current = queuedPrompt.id;
    setMessages(prev => [...prev, { text: queuedPrompt.text, isAi: false, time: getNowTime() }]);
    run(queuedPrompt.text);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (prompt: string) => {
    const planId = activePlanIndex === 0 ? 'p1' : activePlanIndex === 1 ? 'p2' : 'example';
    if (planId === 'example') {
      say("AI Assistant is disabled in the example view.");
      return;
    }
    setIsLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    stepsDoneRef.current = 0;
    const sentFromPlan = activePlanIndex;
    const stale = () => controller.signal.aborted || activePlanRef.current !== sentFromPlan;
    const token = localStorage.getItem('token') || '';

    // The message's turn: the planner and its steps are part of this message (one AI prompt).
    let turn: string | undefined;
    const post = async (text: string, mode: 'auto' | 'cloud' | 'step') => {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: aiHeaders(token),
        body: JSON.stringify({ prompt: text, planId, sceneData: sceneDataRef.current, mode, image: imageRef.current, turn }),
        signal: controller.signal,
      });
      // Live updates ("the AI is busy, trying the next model…") as toasts while it works.
      return readAiResponse(response, s => toast(s.message, s.level));
    };

    try {
      let res = await post(prompt, 'auto');
      if (stale() || res.aborted) return;
      if (typeof res.turn === 'string') turn = res.turn;

      const report = async (change: AiChange) => {
        abortRef.current = null;
        const lines = [res.reply, change.summary, ...change.notes].filter(Boolean);
        setMessages(prev => [...prev, ...lines.map(text => ({ text, isAi: true, time: getNowTime() }))]);
        await saveChatTurn(token, planId, prompt, lines.join('\n'));
      };

      if (res.setPlan) {
        await report(await applyNow(() => onSetPlanRef.current?.(res.setPlan)));
        return;
      }
      if (res.buildCommands?.length) {
        const change = await applyCommandsNow(res.buildCommands);
        if (change.changed || !res.cloud || change.missingTarget) {
          await report(change);
          return;
        }
        say("That's trickier than it looked, so I'm asking the advanced AI to plan it.");
        res = await post(prompt, 'cloud');
        if (stale() || res.aborted) return;
      }
      if (res.error) {
        if (res.busy) say(res.error, { retry: prompt, busy: true });
        else if (res.limit) say(res.error);
        else say("Error: " + res.error);
      } else if (res.steps) {
        if (res.reply) say(res.reply);
        await runSteps(res.steps, post, stale);
      } else if (res.reply) {
        say(res.reply);
      }
    } catch {
      if (controller.signal.aborted) return;
      say("I couldn't reach the server, so nothing was changed. Check your connection and try again.", { retry: prompt });
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const runSteps = async (steps: { instruction: string; command: any }[], post: (text: string, mode: 'step') => Promise<any>, stale: () => boolean) => {
    let failed = 0;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      say(`Step ${i + 1}/${steps.length}: ${step.instruction}`);
      let done = false;
      let notes: string[] = [];
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        const res = await post(step.instruction, 'step');
        if (stale() || res.aborted) return;
        if (res.buildCommands?.length) ({ changed: done, notes } = await applyCommandsNow(res.buildCommands));
      }
      if (!done && step.command) ({ changed: done, notes } = await applyCommandsNow([step.command]));
      if (stale()) return;
      if (done) stepsDoneRef.current++;
      else {
        failed++;
        say(`I couldn't do step ${i + 1}.${notes.length ? ' ' + notes.join(' ') : ''}`);
      }
    }
    if (steps.length) say(failed ? `Finished, but ${failed} of ${steps.length} steps couldn't be done.` : 'All done! Use Undo to step back through the changes.');
  };

  const handleClearChat = async () => {
    const planId = activePlanIndex === 0 ? 'p1' : activePlanIndex === 1 ? 'p2' : 'example';
    if (planId === 'example') return;

    if (window.confirm("Are you sure you want to clear the conversation? This change is irreversible and will delete the chat history permanently.")) {
      const token = localStorage.getItem('token');
      if (token) {
        setIsLoading(true);
        const res = await clearChatHistory(token, planId);
        if (res.success) {
          setMessages([{ text: "Hello! I am your AI assistant. How can I help you design your home today?", isAi: true, time: getNowTime() }]);
        } else {
          alert("Failed to clear chat.");
        }
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h3>
          <Sparkles size={18} color="#2563eb" />
          <span>AI Assistant</span>
        </h3>
        {activePlanIndex !== 2 && (
          <button className="clear-chat-btn" onClick={handleClearChat} title="Clear conversation">
            <Trash2 size={13} />
            <span>Clear Chat</span>
          </button>
        )}
      </div>

      <div className="chat-tabs-row">
        <span
          className={'chat-tab-btn active'}
        >
          Chat
        </span>
      </div>

      <div className="chat-messages">
          <>
            {messages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.isAi ? 'ai' : 'user'}`}>
                <div className="chat-bubble">
                  {msg.isAi && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>
                      <Sparkles size={15} color="#2563eb" />
                      <span>{msg.busy ? 'AI is busy' : msg.retry ? 'Connection problem' : 'Assistant'}</span>
                    </div>
                  )}
                  <div>{msg.text}</div>
                  {msg.retry && (
                    <button className="chat-retry-btn" disabled={isLoading} onClick={() => retry(idx, msg.retry!)}>Try again</button>
                  )}
                </div>
                {msg.time && <span className="chat-timestamp">{msg.time}</span>}
              </div>
            ))}
            {activePlanIndex !== 2 && (
              <PlanImageCard
                key={activePlanIndex}
                background={background}
                planId={activePlanIndex === 0 ? 'p1' : 'p2'}
                onImageRead={onImageRead}
                onImageChoice={onImageChoice}
                onMessage={text => setMessages(prev => [...prev, { text, isAi: true, time: getNowTime() }])}
              />
            )}
            {isLoading && (
              <div className="chat-message ai">
                <div className="chat-bubble chat-thinking">
                  Thinking<span>.</span><span>.</span><span>.</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </>
      </div>

      <div className="chat-input-pill">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={isLoading ? "AI is working… press Stop to cancel" : "Ask AI to modify your plan..."}
        />
        {isLoading ? (
          <button className="chat-stop-btn" onClick={handleStop} title="Stop the AI">■</button>
        ) : (
          <button className="chat-send-btn" onClick={handleSend} title="Send message">
            <Send size={15} />
          </button>
        )}
      </div>
    </div>
  );
});
