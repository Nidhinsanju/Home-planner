import React from 'react';
import { getChatHistory, clearChatHistory, saveChatTurn } from './actions/chat';
import type { Background } from './plan/types';
import type { SetPlanPayload } from './plan/setPlan';
import { PlanImageCard } from './editor/PlanImageCard';

export const TopBar = ({ view, setView, onUndo, canUndo, onRedo, canRedo, unit, setUnit, onSave, dirty, onRemovePlan, onLogout, username, cutaway, setCutaway }: any) => (
  <div className="top-bar">
    <div className="title">Home Planner {username && <span style={{ color: '#8f969f', fontWeight: 'normal' }}>- Welcome, {username}</span>}</div>
    <div className="actions">
      {onSave && <button className="ui-btn dark" onClick={onSave} title="Save (Ctrl+S)">💾 Save{dirty ? ' •' : ''}</button>}
      {onRemovePlan && <button className="ui-btn" onClick={onRemovePlan} style={{ color: '#ef4444' }} title="Delete everything on this plan">🗑 Remove Plan</button>}
      <button className="ui-btn" onClick={onUndo} disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.5 }} title="Undo (Ctrl+Z)">↶ Undo</button>
      <button className="ui-btn" onClick={onRedo} disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.5 }} title="Redo (Ctrl+Y)">Redo ↷</button>
      <button className="ui-btn" onClick={() => setUnit(unit === 'ft' ? 'mt' : 'ft')}>Unit: {unit === 'ft' ? 'ft' : 'm'}</button>
      <div className="seg">
        <button className={`seg-btn ${view === '2d' ? 'active' : ''}`} onClick={() => setView('2d')}>2D Plan</button>
        <button className={`seg-btn ${view === '3d' ? 'active' : ''}`} onClick={() => setView('3d')}>3D View</button>
      </div>
      {view === '3d' && (
        <button className="ui-btn" onClick={() => setCutaway(!cutaway)} title="Show low walls so you can see inside rooms">
          Cutaway: {cutaway ? 'On' : 'Off'}
        </button>
      )}
      {onLogout && <button className="ui-btn" onClick={onLogout} style={{ marginLeft: '12px', background: '#ef4444', color: 'white' }}>Logout</button>}
    </div>
  </div>
);

export const Compass: React.FC<{ rotation: number }> = ({ rotation }) => {
  return (
    <div className="compass" style={{ top: '14px', right: '14px' }}>
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: `rotate(${rotation}rad)` }}>
        <text x="50" y="22" fill="#ef4444" fontSize="18" fontWeight="bold" fontFamily="Arial" textAnchor="middle">N</text>
        <text x="50" y="89" fill="#cbd0d6" fontSize="18" fontWeight="bold" fontFamily="Arial" textAnchor="middle">S</text>
        <text x="87" y="56" fill="#cbd0d6" fontSize="18" fontWeight="bold" fontFamily="Arial" textAnchor="middle">E</text>
        <text x="13" y="56" fill="#cbd0d6" fontSize="18" fontWeight="bold" fontFamily="Arial" textAnchor="middle">W</text>
        <polygon points="50,28 55,50 45,50" fill="#ef4444" />
        <polygon points="50,72 55,50 45,50" fill="#cbd0d6" />
        <circle cx="50" cy="50" r="3" fill="#17191d" />
      </svg>
    </div>
  );
};

// The outcome of applying an AI change: whether the plan changed, what changed in words
// (worked out by comparing the plans), and any problems.
export type AiChange = { changed: boolean; summary: string; notes: string[] };

export const ChatSidebar = ({ onBuildCommands, onSetPlan, activePlanIndex, sceneData, background, onImageRead, onImageChoice }: {
  onBuildCommands?: (cmds: any[]) => Promise<AiChange>;
  onSetPlan?: (payload: SetPlanPayload) => Promise<AiChange>;
  activePlanIndex: number;
  sceneData?: any;
  background?: Background;
  onImageRead: React.ComponentProps<typeof PlanImageCard>['onImageRead'];
  onImageChoice: React.ComponentProps<typeof PlanImageCard>['onImageChoice'];
}) => {
  const [messages, setMessages] = React.useState<{ text: string; isAi: boolean }[]>([
    { text: "Hello! I am your AI assistant. How can I help you design your home today?", isAi: true }
  ]);
  const [input, setInput] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  // The AI reply arrives after an await; read the latest handler/plan through refs so the
  // commands apply to the current scene (not the one captured when the message was sent).
  const onBuildCommandsRef = React.useRef(onBuildCommands);
  const onSetPlanRef = React.useRef(onSetPlan);
  const activePlanRef = React.useRef(activePlanIndex);
  // The uploaded floor plan, sent with every message so the model can see it.
  const imageRef = React.useRef(background?.src);
  React.useEffect(() => {
    onBuildCommandsRef.current = onBuildCommands;
    onSetPlanRef.current = onSetPlan;
    activePlanRef.current = activePlanIndex;
    imageRef.current = background?.src;
  });

  React.useEffect(() => {
    const token = localStorage.getItem('token');
    const planId = activePlanIndex === 0 ? 'p1' : activePlanIndex === 1 ? 'p2' : 'example';
    let cancelled = false;

    setMessages([
      { text: "Hello! I am your AI assistant. How can I help you design your home today?", isAi: true }
    ]);

    if (token && planId !== 'example') {
      getChatHistory(token, planId).then((res) => {
        if (cancelled) return;
        if (res.messages && res.messages.length > 0) {
          const loadedMsgs = res.messages.map((m: any) => ({
            text: m.content,
            isAi: m.role === 'assistant'
          }));
          setMessages([
            { text: "Hello! I am your AI assistant. How can I help you design your home today?", isAi: true },
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

  // The in-flight AI request, so Stop (or switching plans) can cancel it.
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
    setMessages(prev => [...prev, { text: done ? `Stopped. The ${done} step${done > 1 ? "s" : ""} already done stay on the plan (use Undo to remove them).` : "Stopped. No changes were made.", isAi: true }]);
  };

  // The plan as the AI should see it, kept current while a multi-step plan is being built.
  const sceneDataRef = React.useRef(sceneData);
  React.useEffect(() => { sceneDataRef.current = sceneData; });
  // After an AI change, waits (up to ~1 s) for the editor to re-render with the new plan, so
  // the next step is applied to it and not to the plan before the change.
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
  // Steps of a cloud plan already applied, so Stop can say they stay on the plan.
  const stepsDoneRef = React.useRef(0);

  const say = (text: string) => setMessages(prev => [...prev, { text, isAi: true }]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { text: userMsg, isAi: false }]);
    setInput('');
    run(userMsg);
  };

  // Sends one chat message. The local model answers, or decides the request is too complex and
  // has the cloud model plan it as steps, which the local model then carries out. If the local
  // model's own commands can't be applied, the cloud model is asked to plan it instead.
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
    // Stopped, or the user switched plans while waiting: don't touch the plan.
    const stale = () => controller.signal.aborted || activePlanRef.current !== sentFromPlan;
    const token = localStorage.getItem('token') || '';
    const post = async (text: string, mode: 'auto' | 'cloud' | 'step') => {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: text, planId, sceneData: sceneDataRef.current, mode, image: imageRef.current }),
        signal: controller.signal,
      });
      return response.json();
    };

    try {
      let res = await post(prompt, 'auto');
      if (stale() || res.aborted) return;
      // Applies the change first, so the reply says what actually happened, and saves the turn.
      const report = async (change: AiChange) => {
        abortRef.current = null; // the answer is in and applied; Stop no longer applies
        const lines = [res.reply, change.summary, ...change.notes].filter(Boolean);
        setMessages(prev => [...prev, ...lines.map(text => ({ text, isAi: true }))]);
        await saveChatTurn(token, planId, prompt, lines.join('\n'));
      };
      if (res.setPlan) {
        await report(await applyNow(() => onSetPlanRef.current?.(res.setPlan)));
        return;
      }
      if (res.buildCommands?.length) {
        const change = await applyCommandsNow(res.buildCommands);
        if (change.changed || !res.cloud) {
          await report(change);
          return;
        }
        say("That's trickier than it looked, so I'm asking the advanced AI to plan it.");
        res = await post(prompt, 'cloud');
        if (stale() || res.aborted) return;
      }
      if (res.error) {
        say("Error: " + res.error);
      } else if (res.steps) {
        if (res.reply) say(res.reply);
        await runSteps(res.steps, post, stale);
      } else if (res.reply) {
        say(res.reply);
      }
    } catch {
      if (controller.signal.aborted) return; // Stop already reported it
      say("Sorry, I encountered an error communicating with the server.");
    } finally {
      // An aborted request was already wound down by Stop / the plan switch.
      if (!controller.signal.aborted) setIsLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  // Carries out a cloud plan one step at a time. The local model turns each instruction into
  // commands for the current plan; if it fails twice, the cloud model's own command for that
  // step is used instead.
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

    if (window.confirm("Are you sure you want to clear the conversation? This change is irreversible and will delete the chat history permanently from memory and the database.")) {
      const token = localStorage.getItem('token');
      if (token) {
        setIsLoading(true);
        const res = await clearChatHistory(token, planId);
        if (res.success) {
          setMessages([{ text: "Hello! I am your AI assistant. How can I help you design your home today?", isAi: true }]);
        } else {
          alert("Failed to clear chat.");
        }
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>AI Assistant</h3>
        {activePlanIndex !== 2 && (
          <button 
            onClick={handleClearChat}
            style={{ padding: '4px 8px', fontSize: '12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Clear Chat
          </button>
        )}
      </div>
      <div className="chat-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message ${msg.isAi ? 'ai' : 'user'}`}>
            <div className="chat-bubble">
              {msg.text}
            </div>
          </div>
        ))}
        {activePlanIndex !== 2 && (
          <PlanImageCard key={activePlanIndex} background={background} planId={activePlanIndex === 0 ? 'p1' : 'p2'}
            onImageRead={onImageRead} onImageChoice={onImageChoice}
            onMessage={text => setMessages(prev => [...prev, { text, isAi: true }])} />
        )}
        {isLoading && (
          <div className="chat-message ai">
            <div className="chat-bubble chat-thinking">Thinking<span>.</span><span>.</span><span>.</span></div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="chat-input-container">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={isLoading ? "AI is working… press Stop to cancel" : "Ask AI..."}
        />
        {isLoading ? (
          <button className="chat-stop-btn" onClick={handleStop} title="Stop the AI">■ Stop</button>
        ) : (
          <button onClick={handleSend}>Send</button>
        )}
      </div>
    </div>
  );
};
