import React from 'react';
import { getChatHistory, clearChatHistory } from './actions/chat';
import type { Background } from './plan/types';
import { PlanImageCard } from './editor/PlanImageCard';
import { shrinkForVision } from './editor/backgroundImage';

export const TopBar = ({ view, setView, onUndo, canUndo, onRedo, canRedo, unit, setUnit, onSave, dirty, onLogout, username, cutaway, setCutaway }: any) => (
  <div className="top-bar">
    <div className="title">Home Planner {username && <span style={{ color: '#8f969f', fontWeight: 'normal' }}>- Welcome, {username}</span>}</div>
    <div className="actions">
      {onSave && <button className="ui-btn dark" onClick={onSave} title="Save (Ctrl+S)">💾 Save{dirty ? ' •' : ''}</button>}
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

export const ChatSidebar = ({ onBuildCommands, activePlanIndex, sceneData, background, onImageRead, onImageChoice }: {
  onBuildCommands?: (cmds: any[]) => Promise<{ changed: boolean; notes: string[] }>;
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
  const activePlanRef = React.useRef(activePlanIndex);
  React.useEffect(() => {
    onBuildCommandsRef.current = onBuildCommands;
    activePlanRef.current = activePlanIndex;
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
    setMessages(prev => [...prev, { text: "Stopped. No changes were made.", isAi: true }]);
  };

  // A small copy of the uploaded floor plan, sent with each message so the AI can look at it.
  // Kept small (768px) to leave room in the model's context; made once per image.
  const chatImageRef = React.useRef<{ src: string; image: string } | null>(null);
  const chatImage = async () => {
    const src = background?.src;
    if (!src) return undefined;
    if (chatImageRef.current?.src !== src) {
      try {
        chatImageRef.current = { src, image: (await shrinkForVision(src, 768)).image };
      } catch {
        return undefined; // chat still works without the picture
      }
    }
    return chatImageRef.current.image;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { text: userMsg, isAi: false }]);
    setInput('');
    setIsLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const planId = activePlanIndex === 0 ? 'p1' : activePlanIndex === 1 ? 'p2' : 'example';
      if (planId === 'example') {
        setMessages(prev => [...prev, { text: "AI Assistant is disabled in the example view.", isAi: true }]);
        return;
      }
      const sentFromPlan = activePlanIndex;
      const token = localStorage.getItem('token') || '';
      const image = await chatImage();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: userMsg, planId, sceneData, image }),
        signal: controller.signal,
      });
      const res = await response.json();
      // Stopped, or the user switched plans while waiting: don't touch the plan.
      if (controller.signal.aborted || res.aborted || activePlanRef.current !== sentFromPlan) return;
      // The answer is in; from here on the result is applied and Stop no longer applies.
      abortRef.current = null;
      if (res.error) {
        setMessages(prev => [...prev, { text: "Error: " + res.error, isAi: true }]);
      } else if (res.buildCommands?.length) {
        // Apply first, so the reply can say whether anything actually changed.
        const { changed, notes } = (await onBuildCommandsRef.current?.(res.buildCommands)) || { changed: false, notes: [] };
        const summary = res.reply || (changed ? "Done, I've updated the plan." : "I couldn't make that change.");
        setMessages(prev => [...prev, ...[summary, ...notes].map(text => ({ text, isAi: true }))]);
      } else if (res.reply) {
        setMessages(prev => [...prev, { text: res.reply, isAi: true }]);
      }
    } catch {
      if (controller.signal.aborted) return; // Stop already reported it
      setMessages(prev => [...prev, { text: "Sorry, I encountered an error communicating with the server.", isAi: true }]);
    } finally {
      // An aborted request was already wound down by Stop / the plan switch.
      if (!controller.signal.aborted) setIsLoading(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
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
