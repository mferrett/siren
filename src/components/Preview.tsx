import { memo, useEffect, useRef, useState } from "react";
const clampScale = (s: number) => Math.max(0.1, Math.min(8, s));
export const Preview = memo(function Preview({
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
  // Pan/zoom live outside React state so gestures never re-render.
  const view = useRef({ scale: 1, x: 0, y: 0 });
  // Scale baked into the SVG size; any difference is a temporary CSS scale.
  const sized = useRef(1);
  const [zoomLabel, setZoomLabel] = useState(100);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const frameRequest = useRef(0),
    settleTimer = useRef(0);
  const fittedDoc = useRef<string | undefined>(undefined);
  function applyTransform() {
    frameRequest.current = 0;
    if (!host.current) return;
    const { scale, x, y } = view.current;
    const extra = scale / sized.current;
    host.current.style.transform =
      `translate(${Math.round(x)}px, ${Math.round(y)}px)` +
      (extra === 1 ? "" : ` scale(${extra})`);
  }
  function scheduleTransform() {
    if (!frameRequest.current)
      frameRequest.current = requestAnimationFrame(applyTransform);
  }
  function syncSvgSize() {
    const el = shadow.current?.querySelector("svg");
    if (!el) return;
    el.style.maxWidth = "none";
    el.style.display = "block";
    el.style.userSelect = "none";
    el.style.webkitUserSelect = "none";
    const scale = view.current.scale;
    const vb = el.viewBox?.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      const w = Math.max(1, Math.round(vb.width * scale));
      const h = Math.max(1, Math.round(vb.height * scale));
      el.setAttribute("width", String(w));
      el.setAttribute("height", String(h));
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      sized.current = scale;
    } else sized.current = 1;
  }
  function commit() {
    clearTimeout(settleTimer.current);
    cancelAnimationFrame(frameRequest.current);
    syncSvgSize();
    applyTransform();
    setZoomLabel(Math.round(view.current.scale * 100));
  }
  // (fx, fy) is relative to the frame centre and stays fixed on screen.
  function zoomTo(next: number, fx = 0, fy = 0, defer = false) {
    const v = view.current;
    const scale = clampScale(next);
    const r = scale / v.scale;
    view.current = { scale, x: fx - (fx - v.x) * r, y: fy - (fy - v.y) * r };
    if (!defer) return commit();
    scheduleTransform();
    clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(commit, 150);
  }
  useEffect(() => {
    if (!host.current) return;
    shadow.current ??= host.current.attachShadow({ mode: "open" });
    shadow.current.innerHTML = svg;
    if (!shadow.current.querySelector("svg")) return;
    if (fittedDoc.current !== docId) {
      fittedDoc.current = docId;
      fit();
    } else {
      syncSvgSize();
      applyTransform();
    }
  }, [svg, docId]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      zoomTo(
        view.current.scale * Math.exp(-e.deltaY * unit * speed),
        e.clientX - rect.left - rect.width / 2,
        e.clientY - rect.top - rect.height / 2,
        true,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frameRequest.current);
      clearTimeout(settleTimer.current);
    };
  }, []);
  function fit() {
    const svg = shadow.current?.querySelector("svg");
    if (!svg || !frame.current) return;
    const b = svg.viewBox.baseVal;
    if (!b || !b.width || !b.height) return;
    view.current = {
      scale: clampScale(
        Math.min(
          (frame.current.clientWidth - 80) / b.width,
          (frame.current.clientHeight - 80) / b.height,
          2,
        ),
      ),
      x: 0,
      y: 0,
    };
    commit();
  }
  return (
    <div
      className="preview-area"
      ref={frame}
      onPointerDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button"))
          return;
        drag.current = {
          x: e.clientX - view.current.x,
          y: e.clientY - view.current.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        view.current.x = e.clientX - d.x;
        view.current.y = e.clientY - d.y;
        scheduleTransform();
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        const rect = e.currentTarget.getBoundingClientRect();
        zoomTo(
          view.current.scale * 2,
          e.clientX - rect.left - rect.width / 2,
          e.clientY - rect.top - rect.height / 2,
        );
      }}
    >
      {!svg && (
        <div className="empty-preview">Your diagram will appear here</div>
      )}
      <div className="svg-position">
        <div ref={host} />
      </div>
      <div className="zoom-controls">
        <button
          title="Zoom out"
          onClick={() => zoomTo(view.current.scale / 1.2)}
        >
          −
        </button>
        <button
          onClick={() => {
            view.current = { scale: 1, x: 0, y: 0 };
            commit();
          }}
        >
          {zoomLabel}%
        </button>
        <button
          title="Zoom in"
          onClick={() => zoomTo(view.current.scale * 1.2)}
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
});
