import React from 'react';
import { LEGO_TYPES } from './constants';
import { processChat, getChatHistory } from './actions/chat';

import { LayoutDashboard, Hammer, Armchair, Paintbrush, ChevronLeft } from 'lucide-react';

export const TopBar = ({ view, setView, onUndo, canUndo, onRedo, canRedo, unit, setUnit, onSave, onLogout, username }: any) => (
  <div className="top-bar">
    <div className="title">Vastu 3D Home Planner {username && <span style={{color: '#8f969f', fontWeight: 'normal'}}>- Welcome, {username}</span>}</div>
    <div className="actions">
      {onSave && <button className="ui-btn dark" onClick={onSave}>💾 Save Plan</button>}
      <button className="ui-btn" onClick={() => setUnit(unit === 'ft' ? 'mt' : 'ft')}>Unit: {unit}</button>
      <button className="ui-btn" onClick={() => setView('top')} style={{ background: view === 'top' ? '#fff' : '' }}>2D View</button>
      <button className="ui-btn" onClick={() => setView('3d')} style={{ background: view === '3d' ? '#fff' : '' }}>3D View</button>
      <button className="ui-btn" onClick={onUndo} disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.5 }}>↶ Undo</button>
      <button className="ui-btn" onClick={onRedo} disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.5 }}>Redo ↷</button>
      {onLogout && <button className="ui-btn" onClick={onLogout} style={{ marginLeft: '12px', background: '#ef4444', color: 'white' }}>Logout</button>}
    </div>
  </div>
);

export const Sidebar = ({ 
  plotW, setPlotW, plotD, setPlotD, unit, 
  buildMode, setBuildMode, eraserMode, setEraserMode, 
  activePlanIndex, onSwitchPlan, selectedItem, onClearSelection,
  wallThickness, setWallThickness, wallHeight, setWallHeight, wallRaise, setWallRaise,
  model, customBlocks, onUpdateObject, onDeleteObject
}: any) => {
  const isReadOnly = activePlanIndex === 2;
  const [activeTab, setActiveTab] = React.useState('build');
  const [openCategory, setOpenCategory] = React.useState<string | null>(null);

  const groupedLego = LEGO_TYPES.reduce((acc, curr) => {
    const cat = curr.category || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(curr);
    return acc;
  }, {} as Record<string, typeof LEGO_TYPES>);

  return (
    <div className="sidebar-container">
      {/* Icon Strip */}
      <div className="sidebar-icons">
        <button className={`sidebar-icon-btn ${activeTab === 'project' ? 'active' : ''}`} onClick={() => setActiveTab('project')} title="Project & Plans">
          <LayoutDashboard size={20} />
        </button>
        <button className={`sidebar-icon-btn ${activeTab === 'build' ? 'active' : ''}`} onClick={() => setActiveTab('build')} title="Build Tools">
          <Hammer size={20} />
        </button>
        <button className={`sidebar-icon-btn ${activeTab === 'furniture' ? 'active' : ''}`} onClick={() => setActiveTab('furniture')} title="Furniture">
          <Armchair size={20} />
        </button>
        <button className={`sidebar-icon-btn ${activeTab === 'paint' ? 'active' : ''}`} onClick={() => setActiveTab('paint')} title="Paint & Materials">
          <Paintbrush size={20} />
        </button>
      </div>

      {/* Content Panel */}
      <div className="sidebar-panel">
        {selectedItem ? (
          <div className="sidebar-section">
            <button className="back-btn" onClick={onClearSelection}>
              <ChevronLeft size={16} /> Back
            </button>
            <h3>Settings</h3>
            {(() => {
              let obj: any = null;
              if (selectedItem.type === 'door') obj = model.doors?.find((d: any) => d.id === selectedItem.id);
              if (selectedItem.type === 'window') obj = model.windows?.find((w: any) => w.id === selectedItem.id);
              if (selectedItem.type === 'wall') obj = model.walls?.find((w: any) => w.id === selectedItem.id);
              if (selectedItem.type === 'custom') obj = customBlocks?.find((c: any) => c.id === selectedItem.id);
              if (selectedItem.type === 'room') obj = model.rooms?.find((r: any) => r.id === selectedItem.id);

              if (!obj) return <div className="selected-info">Object not found.</div>;

              return (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ marginBottom: '16px', fontSize: '14px', fontWeight: 'bold', color: '#fff', textTransform: 'capitalize' }}>
                    {selectedItem.type} Properties
                  </div>
                  
                  {selectedItem.type === 'door' && (
                    <>
                      <div className="prop-group">
                        <label>Position X (m)</label>
                        <input type="number" step="0.1" value={obj.x || 0} onChange={e => onUpdateObject(obj.id, 'door', { x: parseFloat(e.target.value) || 0 })} />
                      </div>
                      <div className="prop-group">
                        <label>Position Y (m)</label>
                        <input type="number" step="0.1" value={obj.y || 0} onChange={e => onUpdateObject(obj.id, 'door', { y: parseFloat(e.target.value) || 0 })} />
                      </div>
                      <div className="prop-group">
                        <label>Width (m)</label>
                        <input type="number" step="0.1" value={obj.width || 1} onChange={e => onUpdateObject(obj.id, 'door', { width: parseFloat(e.target.value) || 1 })} />
                      </div>
                      <div className="prop-group">
                        <label>Height (m)</label>
                        <input type="number" step="0.1" value={obj.height || 2.1} onChange={e => onUpdateObject(obj.id, 'door', { height: parseFloat(e.target.value) || 2.1 })} />
                      </div>
                    </>
                  )}

                  {selectedItem.type === 'window' && (
                    <>
                      <div className="prop-group">
                        <label>Position X (m)</label>
                        <input type="number" step="0.1" value={obj.x || 0} onChange={e => onUpdateObject(obj.id, 'window', { x: parseFloat(e.target.value) || 0 })} />
                      </div>
                      <div className="prop-group">
                        <label>Position Y (m)</label>
                        <input type="number" step="0.1" value={obj.y || 0} onChange={e => onUpdateObject(obj.id, 'window', { y: parseFloat(e.target.value) || 0 })} />
                      </div>
                      <div className="prop-group">
                        <label>Width (m)</label>
                        <input type="number" step="0.1" value={obj.width || 1.5} onChange={e => onUpdateObject(obj.id, 'window', { width: parseFloat(e.target.value) || 1.5 })} />
                      </div>
                      <div className="prop-group">
                        <label>Height (m)</label>
                        <input type="number" step="0.1" value={obj.height || 1.2} onChange={e => onUpdateObject(obj.id, 'window', { height: parseFloat(e.target.value) || 1.2 })} />
                      </div>
                      <div className="prop-group">
                        <label>Sill Height (m)</label>
                        <input type="number" step="0.1" value={obj.sillHeight || 0.9} onChange={e => onUpdateObject(obj.id, 'window', { sillHeight: parseFloat(e.target.value) || 0.9 })} />
                      </div>
                    </>
                  )}

                  {selectedItem.type === 'wall' && (
                    <>
                      <div className="prop-group">
                        <label>Thickness (m)</label>
                        <input type="number" step="0.01" value={obj.thickness || 0.15} onChange={e => onUpdateObject(obj.id, 'wall', { thickness: parseFloat(e.target.value) || 0.15 })} />
                      </div>
                      <div className="prop-group">
                        <label>Height (m)</label>
                        <input type="number" step="0.1" value={obj.height || 2.8} onChange={e => onUpdateObject(obj.id, 'wall', { height: parseFloat(e.target.value) || 2.8 })} />
                      </div>
                      <div className="prop-group">
                        <label>Raise from Floor (m)</label>
                        <input type="number" step="0.1" value={obj.raise || 0} onChange={e => onUpdateObject(obj.id, 'wall', { raise: parseFloat(e.target.value) || 0 })} />
                      </div>
                    </>
                  )}

                  {selectedItem.type === 'room' && (
                    <>
                      <div className="prop-group">
                        <label>Name</label>
                        <input type="text" value={obj.name || ''} onChange={e => onUpdateObject(obj.id, 'room', { name: e.target.value })} />
                      </div>
                    </>
                  )}

                  {selectedItem.type === 'custom' && (
                    <>
                      <div className="prop-group">
                        <label>Position X (m)</label>
                        <input type="number" step="0.1" value={obj.x || 0} onChange={e => onUpdateObject(obj.id, 'custom', { x: parseFloat(e.target.value) || 0 })} />
                      </div>
                      <div className="prop-group">
                        <label>Position Y (m)</label>
                        <input type="number" step="0.1" value={obj.z || 0} onChange={e => onUpdateObject(obj.id, 'custom', { z: parseFloat(e.target.value) || 0 })} />
                      </div>
                      <div style={{ color: '#8f969f', fontSize: '13px', marginBottom: '12px', marginTop: '8px' }}>
                        Custom blocks have fixed dimensions in this view.
                      </div>
                    </>
                  )}

                  <button 
                    style={{ marginTop: '16px', background: '#ef4444', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', width: '100%', cursor: 'pointer' }}
                    onClick={() => onDeleteObject(obj.id, selectedItem.type)}
                  >
                    Delete {selectedItem.type}
                  </button>
                </div>
              );
            })()}
          </div>
        ) : (
          <>
            {activeTab === 'project' && (
              <div className="sidebar-section">
                <h3>Plans</h3>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
                  {[1, 2, 3].map((n, i) => (
                    <button 
                      key={i} 
                      className="component-btn" 
                      style={{ 
                        flex: 1, padding: '6px', textAlign: 'center', margin: 0,
                        background: activePlanIndex === i ? '#3b82f6' : '#2b3038',
                        borderColor: activePlanIndex === i ? '#3b82f6' : '#3c4148'
                      }}
                      onClick={() => onSwitchPlan(i as 0|1|2)}
                    >
                      {i === 2 ? 'Example' : `P${n}`}
                    </button>
                  ))}
                </div>
                
                {isReadOnly && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '10px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
                    This is a read-only example plan. Switch to P1 or P2 to edit.
                  </div>
                )}

                <h3>Project Setup</h3>
                <div className="prop-group">
                  <label>Plot Width ({unit})</label>
                  <input type="number" value={plotW} onChange={e => setPlotW(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="prop-group">
                  <label>Plot Depth ({unit})</label>
                  <input type="number" value={plotD} onChange={e => setPlotD(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
            )}

            {activeTab === 'build' && (
              <>
                <div className="sidebar-section" style={{ opacity: isReadOnly ? 0.5 : 1, pointerEvents: isReadOnly ? 'none' : 'auto' }}>
                  <h3>Tools</h3>
                  <button className="component-btn" style={{ borderColor: eraserMode ? '#ef4444' : '#3c4148' }} onClick={() => { setEraserMode(!eraserMode); setBuildMode(null); }}>
                    ⛏️ Eraser Mode {eraserMode ? 'ON' : 'OFF'}
                  </button>
                  
                  {buildMode === 'wall_draw' && (
                    <div style={{ marginTop: '16px', background: '#2b3038', padding: '12px', borderRadius: '8px', border: '1px solid #3c4148' }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#cbd0d6' }}>Wall Settings</h4>
                      <div className="prop-group">
                        <label>Thickness (m)</label>
                        <input type="number" step="0.01" value={wallThickness} onChange={e => setWallThickness(parseFloat(e.target.value) || 0)} />
                      </div>
                      <div className="prop-group">
                        <label>Height (m)</label>
                        <input type="number" step="0.1" value={wallHeight} onChange={e => setWallHeight(parseFloat(e.target.value) || 0)} />
                      </div>
                      <div className="prop-group">
                        <label>Raise from Floor (m)</label>
                        <input type="number" step="0.1" value={wallRaise} onChange={e => setWallRaise(parseFloat(e.target.value) || 0)} />
                      </div>
                      <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#8f969f' }}>Click on grid to start and stop drawing wall.</p>
                    </div>
                  )}
                </div>

                <div className="sidebar-section" style={{ opacity: isReadOnly ? 0.5 : 1, pointerEvents: isReadOnly ? 'none' : 'auto' }}>
                  <h3>Build Components</h3>
                  {Object.entries(groupedLego).map(([category, items]) => (
                    <div key={category} style={{ marginBottom: '8px' }}>
                      <button 
                        className="component-btn" 
                        style={{ 
                          fontWeight: 'bold', 
                          background: openCategory === category ? '#3b82f6' : '#2b3038',
                          borderColor: openCategory === category ? '#3b82f6' : '#3c4148'
                        }}
                        onClick={() => setOpenCategory(openCategory === category ? null : category)}
                      >
                        {openCategory === category ? '▼' : '▶'} {category}
                      </button>
                      
                      {openCategory === category && (
                        <div style={{ paddingLeft: '12px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {items.map(type => (
                            <button 
                              key={type.id} 
                              className="component-btn"
                              style={{ 
                                borderColor: buildMode === type.id ? '#3b82f6' : '#3c4148',
                                margin: 0, fontSize: '13px', padding: '6px 12px'
                              }}
                              onClick={() => {
                                setBuildMode(buildMode === type.id ? null : type.id);
                                setEraserMode(false);
                              }}
                            >
                              + {type.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {(activeTab === 'furniture' || activeTab === 'paint') && (
              <div className="sidebar-section">
                <h3>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h3>
                <p style={{ color: '#8f969f', fontSize: '13px' }}>This tool is not fully implemented yet.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

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

export const ChatSidebar = ({ onBuildCommand, activePlanIndex, sceneData }: { onBuildCommand?: (cmd: any) => void, activePlanIndex: number, sceneData?: any }) => {
  const [messages, setMessages] = React.useState<{ text: string; isAi: boolean }[]>([
    { text: "Hello! I am your AI assistant. How can I help you design your home today?", isAi: true }
  ]);
  const [input, setInput] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const token = localStorage.getItem('token');
    const planId = activePlanIndex === 0 ? 'p1' : activePlanIndex === 1 ? 'p2' : 'example';
    
    setMessages([
      { text: "Hello! I am your AI assistant. How can I help you design your home today?", isAi: true }
    ]);

    if (token && planId !== 'example') {
      getChatHistory(token, planId).then((res) => {
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
  }, [activePlanIndex]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { text: userMsg, isAi: false }]);
    setInput('');
    setIsLoading(true);
    
    try {
      const planId = activePlanIndex === 0 ? 'p1' : activePlanIndex === 1 ? 'p2' : 'example';
      if (planId === 'example') {
        setMessages(prev => [...prev, { text: "AI Assistant is disabled in the example view.", isAi: true }]);
        setIsLoading(false);
        return;
      }
      const token = localStorage.getItem('token') || '';
      const res = await processChat(userMsg, token, planId, sceneData);
      if (res.error) {
        setMessages(prev => [...prev, { text: "Error: " + res.error, isAi: true }]);
      } else if (res.buildCommand) {
        setMessages(prev => [...prev, { text: res.reply || "I've processed your command and updated the 3D scene!", isAi: true }]);
        if (onBuildCommand) {
          onBuildCommand(res.buildCommand);
        }
      } else if (res.reply) {
        setMessages(prev => [...prev, { text: res.reply, isAi: true }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { text: "Sorry, I encountered an error communicating with the server.", isAi: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h3>AI Assistant</h3>
      </div>
      <div className="chat-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message ${msg.isAi ? 'ai' : 'user'}`}>
            <div className="chat-bubble">
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="chat-input-container">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask AI..."
        />
        <button onClick={handleSend}>Send</button>
      </div>
    </div>
  );
};
