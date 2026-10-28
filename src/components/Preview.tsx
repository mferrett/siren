import { useEffect, useRef, useState } from "react";
export function Preview({
  svg,
  docId,
  fullscreen,
  onToggleFullscreen,
}: {
  svg: string;
  docId?: string;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null),
    shadow = useRef<ShadowRoot | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const fittedDoc = useRef<string | undefined>(undefined);
  function syncSvgSize(scale: number) {
    const el = shadow.current?.querySelector("svg");
    if (!el) return;
    el.style.maxWidth = "none";
    el.style.display = "block";
    el.style.userSelect = "none";
    el.style.webkitUserSelect = "none";
    const vb = el.viewBox?.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      const w = Math.max(1, Math.round(vb.width * scale));
      const h = Math.max(1, Math.round(vb.height * scale));
      el.setAttribute("width", String(w));
      el.setAttribute("height", String(h));
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
  }
  useEffect(() => {
    if (!host.current) return;
    shadow.current ??= host.current.attachShadow({ mode: "open" });
    shadow.current.innerHTML = svg;
    const el = shadow.current.querySelector("svg");
    if (el) {
      if (fittedDoc.current !== docId) {
        fittedDoc.current = docId;
        fit();
      } else {
        syncSvgSize(view.scale);
      }
    }
  }, [svg, docId]);
  useEffect(() => {
    syncSvgSize(view.scale);
  }, [view.scale]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => ({
        ...v,
        scale: Math.max(
          0.1,
          Math.min(8, v.scale * (e.deltaY > 0 ? 0.9 : 1.1)),
        ),
      }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  function fit() {
    const svg = shadow.current?.querySelector("svg");
    if (!svg || !frame.current) return;
    const b = svg.viewBox.baseVal;
    if (!b || !b.width || !b.height) return;
    const nextScale = Math.min(
      (frame.current.clientWidth - 80) / b.width,
      (frame.current.clientHeight - 80) / b.height,
      2,
    );
    syncSvgSize(nextScale);
    setView({
      scale: nextScale,
      x: 0,
      y: 0,
    });
  }
  return (
    <div
      className="preview-area"
      ref={frame}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        drag.current = { x: e.clientX - view.x, y: e.clientY - view.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current) {
          const d = drag.current;
          setView((v) => ({ ...v, x: e.clientX - d.x, y: e.clientY - d.y }));
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {!svg && (
        <div className="empty-preview">Your diagram will appear here</div>
      )}
      <div className="svg-position">
        <div
          ref={host}
          style={{
            transform: `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px)`,
          }}
        />
      </div>
      <div className="zoom-controls">
        <button
          title="Zoom out"
          onClick={() =>
            setView((v) => ({ ...v, scale: Math.max(0.1, v.scale / 1.2) }))
          }
        >
          −
        </button>
        <button onClick={() => setView({ scale: 1, x: 0, y: 0 })}>
          {Math.round(view.scale * 100)}%
        </button>
        <button
          title="Zoom in"
          onClick={() =>
            setView((v) => ({ ...v, scale: Math.min(8, v.scale * 1.2) }))
          }
        >
          +
        </button>
        <span />
        <button onClick={fit}>Fit</button>
        {onToggleFullscreen && (
          <>
            <span />
            <button
              title={fullscreen ? "Exit Full Screen (Esc)" : "Full Screen"}
              onClick={onToggleFullscreen}
            >
              {fullscreen ? "Exit ⛶" : "⛶"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
