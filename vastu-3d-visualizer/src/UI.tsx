import React from 'react';
import { initialRoomState } from './constants';

type AppState = {
  roofOn: boolean;
  setRoofOn: (val: boolean) => void;
  labelsOn: boolean;
  setLabelsOn: (val: boolean) => void;
  selectedText: string;
  setView: (view: '3d' | 'top') => void;
  onUndo: () => void;
  canUndo: boolean;
  onRedo: () => void;
  canRedo: boolean;
};

export const UI: React.FC<AppState> = ({ roofOn, setRoofOn, labelsOn, setLabelsOn, selectedText, setView, onUndo, canUndo, onRedo, canRedo }) => {
  return (
    <div className="ui-panel">
      <h2>Ground Floor · 40 × 30 ft</h2>
      <div className="sub">
        Rebuilt in React + R3F: Interactive spatial concept with dynamic room swapping and Vastu validation.
      </div>
      
      <button className="ui-btn" onClick={() => setView('3d')}>3D View</button>
      <button className="ui-btn" onClick={() => setView('top')}>Top View</button>
      <br />
      <button className="ui-btn" onClick={onUndo} disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.5 }}>Undo</button>
      <button className="ui-btn" onClick={onRedo} disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.5 }}>Redo</button>
      <button className="ui-btn dark" onClick={() => setRoofOn(!roofOn)}>
        {roofOn ? "Hide Roof/Walls" : "Show Roof/Walls"}
      </button>
      <button className="ui-btn dark" onClick={() => setLabelsOn(!labelsOn)}>
        {labelsOn ? "Hide Labels" : "Show Labels"}
      </button>

      <div className="selected-info" dangerouslySetInnerHTML={{ __html: selectedText }} />

      <div className="legend">
        <div><span className="legend-dot" style={{background: '#d7c4aa'}}></span>Living / Dining</div>
        <div><span className="legend-dot" style={{background: '#c9b8a3'}}></span>Bedrooms</div>
        <div><span className="legend-dot" style={{background: '#b7c5ca'}}></span>Kitchen / Utility</div>
        <div><span className="legend-dot" style={{background: '#d0c2d7'}}></span>Pooja / Toilets</div>
      </div>
      <div className="hint">Drag = rotate · Wheel = zoom · Right-drag = pan</div>
    </div>
  );
};

export const Compass: React.FC<{ rotation: number }> = ({ rotation }) => {
  return (
    <div className="compass">
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
