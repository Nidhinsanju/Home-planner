import React from 'react';
import { LEGO_TYPES } from './constants';

export const TopBar = ({ view, setView, onUndo, canUndo, onRedo, canRedo, unit, setUnit }: any) => (
  <div className="top-bar">
    <div className="title">Vastu 3D Home Planner</div>
    <div className="actions">
      <button className="ui-btn" onClick={() => setUnit(unit === 'ft' ? 'mt' : 'ft')}>Unit: {unit}</button>
      <button className="ui-btn" onClick={() => setView('top')} style={{ background: view === 'top' ? '#fff' : '' }}>2D View</button>
      <button className="ui-btn" onClick={() => setView('3d')} style={{ background: view === '3d' ? '#fff' : '' }}>3D View</button>
      <button className="ui-btn" onClick={onUndo} disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.5 }}>↶ Undo</button>
      <button className="ui-btn" onClick={onRedo} disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.5 }}>Redo ↷</button>
    </div>
  </div>
);

export const ComponentsSidebar = ({ plotW, setPlotW, plotD, setPlotD, unit, buildMode, setBuildMode, eraserMode, setEraserMode, activePlanIndex, onSwitchPlan }: any) => {
  const isReadOnly = activePlanIndex === 2;
  
  return (
  <div className="left-sidebar">
    <div className="sidebar-section">
      <h3>Plans</h3>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
        {[1, 2, 3].map((n, i) => (
          <button 
            key={i} 
            className="component-btn" 
            style={{ 
              flex: 1, 
              padding: '6px', 
              textAlign: 'center', 
              margin: 0,
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

    <div className="sidebar-section" style={{ opacity: isReadOnly ? 0.5 : 1, pointerEvents: isReadOnly ? 'none' : 'auto' }}>
      <h3>Tools</h3>
      <button className="component-btn" style={{ borderColor: eraserMode ? '#ef4444' : '#3c4148' }} onClick={() => { setEraserMode(!eraserMode); setBuildMode(null); }}>
        ⛏️ Eraser Mode {eraserMode ? 'ON' : 'OFF'}
      </button>
    </div>

    <div className="sidebar-section" style={{ opacity: isReadOnly ? 0.5 : 1, pointerEvents: isReadOnly ? 'none' : 'auto' }}>
      <h3>Build Components</h3>
      {LEGO_TYPES.map(type => (
        <button 
          key={type.id} 
          className="component-btn"
          style={{ borderColor: buildMode === type.id ? '#3b82f6' : '#3c4148' }}
          onClick={() => {
            setBuildMode(buildMode === type.id ? null : type.id);
            setEraserMode(false);
          }}
        >
          + {type.name}
        </button>
      ))}
    </div>
  </div>
  );
};

export const PropertiesSidebar = ({ selectedText }: { selectedText: string }) => (
  <div className="right-sidebar">
    <div className="sidebar-section">
      <h3>Properties</h3>
      <div className="selected-info" dangerouslySetInnerHTML={{ __html: selectedText }} style={{ marginTop: 0 }} />
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
