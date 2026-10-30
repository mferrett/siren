import { memo, useState, type DragEvent } from "react";
import { DocItem, sameDocItems } from "../lib/documents";
import type { ContextMenuState } from "./Sidebar";
type Props = {
  items: DocItem[];
  active: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string) => void;
  onMove: (fromId: string, toId: string, after: boolean) => void;
  onContextMenu: (menu: ContextMenuState) => void;
};
// Comparing against the midpoint keeps adjacent tabs from swapping back and forth.
function pastMidpoint(e: DragEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX > r.left + r.width / 2;
}
function TabBarView({
  items,
  active,
  onActivate,
  onClose,
  onRename,
  onMove,
  onContextMenu,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  return (
    <div className="document-tabs" role="tablist" aria-label="Open diagrams">
      {items.map((d) => (
        <div
          key={d.id}
          draggable
          className={`tab-item ${d.id === active ? "active" : ""} ${dragId === d.id ? "dragging" : ""}`}
          onDragStart={(e) => {
            setDragId(d.id);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", d.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragId && dragId !== d.id) onMove(dragId, d.id, pastMidpoint(e));
          }}
          onDrop={(e) => {
            e.preventDefault();
            const from = dragId || e.dataTransfer.getData("text/plain");
            if (from && from !== d.id) onMove(from, d.id, pastMidpoint(e));
            setDragId(null);
          }}
          onDragEnd={() => setDragId(null)}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(d.id);
            }
          }}
          onDoubleClick={() => onRename(d.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu({
              kind: "tab",
              id: d.id,
              x: Math.min(e.clientX, window.innerWidth - 160),
              y: Math.min(e.clientY, window.innerHeight - 100),
            });
          }}
        >
          <button
            role="tab"
            className="tab-open"
            aria-selected={d.id === active}
            title={d.name}
            onClick={() => onActivate(d.id)}
          >
            <span className="tab-label">{d.name}</span>
            {d.dirty && <span className="tab-dirty">•</span>}
          </button>
          <button
            className="tab-close"
            title="Close Tab (⌘W)"
            aria-label={`Close ${d.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(d.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
export const TabBar = memo(
  TabBarView,
  (a, b) =>
    a.active === b.active &&
    a.onActivate === b.onActivate &&
    a.onClose === b.onClose &&
    a.onRename === b.onRename &&
    a.onMove === b.onMove &&
    a.onContextMenu === b.onContextMenu &&
    sameDocItems(a.items, b.items),
);
