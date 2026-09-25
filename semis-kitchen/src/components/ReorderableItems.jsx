import { useEffect, useRef, useState } from 'react';
import { itemGroups } from '../lib/menuOrdering.js';

export default function ReorderableItems({ items, disabled, onMove, children }) {
  const groups = itemGroups(items);
  const root = useRef(null);
  const drag = useRef(null);
  const [active, setActive] = useState(null);
  const [marker, setMarker] = useState(null);
  const cancel = () => { drag.current=null; setActive(null); setMarker(null); };

  const locate = () => {
    const d = drag.current;
    if (!d?.moved || !root.current) return;
    const nodes = [...root.current.querySelectorAll('[data-reorder-key]')];
    const bounds = root.current.getBoundingClientRect();
    const hit = nodes.find(node => { const r=node.getBoundingClientRect(); return d.y>=r.top && d.y<=r.bottom; });
    let target=null;
    if (d.x>=bounds.left && d.x<=bounds.right && (!hit || hit.dataset.reorderSection===d.section)) {
      let distance=Infinity;
      for (const node of nodes) {
        if (node.dataset.reorderSection!==d.section) continue;
        const r=node.getBoundingClientRect(), center=r.top+r.height/2;
        if (Math.abs(d.y-center)<distance) {
          distance=Math.abs(d.y-center);
          target={key:node.dataset.reorderKey,after:d.y>center};
        }
      }
    }
    d.target=target;
    setMarker(previous=>previous?.key===target?.key && previous?.after===target?.after ? previous : target);
  };

  useEffect(() => {
    if (!active) return;
    let frame;
    const tick = () => {
      const d=drag.current;
      if (!d) return;
      if (d.moved) {
        const speed=d.y<80?-12:d.y>window.innerHeight-80?12:0;
        if (speed) { window.scrollBy(0,speed); locate(); }
      }
      frame=requestAnimationFrame(tick);
    };
    const escape = event => { if(event.key==='Escape'){ event.preventDefault(); cancel(); } };
    frame=requestAnimationFrame(tick);
    window.addEventListener('keydown',escape);
    window.addEventListener('blur',cancel);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown',escape); window.removeEventListener('blur',cancel); };
  },[active]);

  function finish(event) {
    const d=drag.current;
    if (!d || event.pointerId!==d.pointerId) return;
    const target=d.target;
    cancel();
    if (d.moved && target && target.key!==d.key) onMove(d.key,target.key,target.after);
  }
  return <div ref={root} className="space-y-3">
    <p id="reorder-help" className="text-xs text-green-800">Drag the two-line handle up or down within a section. Keyboard: focus the handle and use ↑ or ↓. Escape cancels dragging. Clear search to reorder.</p>
    {groups.map(group => <div key={group.key} data-reorder-key={group.key} data-reorder-section={group.section}
      className={`relative flex items-start gap-2 rounded-xl ${active===group.key?'opacity-60':''}`}>
      {marker?.key===group.key && marker.key!==active && <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 h-1 rounded bg-amber-500 ${marker.after?'-bottom-1':'-top-1'}`} />}
      <button type="button" aria-label={`Move ${group.items[0].name}`} aria-describedby="reorder-help"
        title="Drag to reorder; use arrow keys with keyboard" disabled={disabled}
        className="mt-2 flex h-11 w-11 shrink-0 touch-none select-none flex-col items-center justify-center gap-1 rounded-lg text-green-800 hover:bg-green-100 focus-visible:outline-2 focus-visible:outline-amber-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-grab active:cursor-grabbing"
        onPointerDown={event=>{
          if(disabled || event.button!==0)return;
          event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          drag.current={key:group.key,section:group.section,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moved:false,target:null};
          setActive(group.key);
        }}
        onPointerMove={event=>{
          const d=drag.current;
          if(!d || d.pointerId!==event.pointerId)return;
          d.x=event.clientX; d.y=event.clientY;
          d.moved ||= Math.hypot(d.x-d.startX,d.y-d.startY)>5;
          locate();
        }} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
        onKeyDown={event=>{
          if(disabled || active || !['ArrowUp','ArrowDown'].includes(event.key))return;
          event.preventDefault();
          const peers=groups.filter(g=>g.section===group.section), index=peers.indexOf(group);
          const target=peers[index+(event.key==='ArrowUp'?-1:1)];
          if(target)onMove(group.key,target.key,event.key==='ArrowDown');
        }}>
        <span aria-hidden="true" className="block h-0.5 w-4 rounded bg-current" />
        <span aria-hidden="true" className="block h-0.5 w-4 rounded bg-current" />
      </button>
      <div className="min-w-0 flex-1 space-y-2">
        {group.items.length>1 && <p className="text-xs text-green-800">Chattipathiri weight options move together.</p>}
        {group.items.map(children)}
      </div>
    </div>)}
  </div>;
}
