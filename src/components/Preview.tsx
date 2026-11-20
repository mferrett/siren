import { memo, useEffect, useRef, useState } from "react";
import { bindPreviewSource, type PreviewSource } from "../lib/previewNavigation";
const clampScale = (s: number) => Math.max(0.1, Math.min(8, s));
export const Preview = memo(function Preview({
  svg,
  docId,
  fullscreen,
  onToggleFullscreen,
  source,
  onNavigate,
}: {
  svg: string;
  source?: PreviewSource;
  onNavigate?: (line: number) => void;
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
  const drag = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    line?: number;
    moved: boolean;
  } | null>(null);
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
    const root = shadow.current;
    const diagram = root.querySelector("svg");
    if (!diagram) return;
    if (source) bindPreviewSource(diagram, source);
    const hoverStyle = document.createElement("style");
    hoverStyle.textContent = `
      [data-source-line], [data-source-line] * { cursor: pointer !important; }
      [data-preview-hover]:not(.preview-edge-hit) {
        filter: drop-shadow(0 0 3px #3b82f6) drop-shadow(0 0 2px #3b82f6);
      }
      .preview-edge-hit[data-preview-hover] {
        stroke: #3b82f64d !important;
        stroke-dasharray: none !important;
      }
      [data-preview-hover] .edgeLabel {
        outline: 2px solid #3b82f6;
        outline-offset: 3px;
        border-radius: 3px;
      }
    `;
    root.append(hoverStyle);
    let hovered: Element[] = [];
    const shapeStyles = new Map<SVGElement, string | null>();
    const clearHover = () => {
      for (const [shape, style] of shapeStyles) {
        if (style === null) shape.removeAttribute("style");
        else shape.setAttribute("style", style);
      }
      shapeStyles.clear();
      hovered.forEach((el) => el.removeAttribute("data-preview-hover"));
      hovered = [];
    };
    const onPointerOver = (event: Event) => {
      const target =
        event.target instanceof Element
          ? event.target
              .closest("[data-preview-target]")
              ?.getAttribute("data-preview-target")
          : null;
      clearHover();
      if (target) {
        hovered = Array.from(
          root.querySelectorAll("[data-preview-target]"),
        ).filter((el) => el.getAttribute("data-preview-target") === target);
        hovered.forEach((el) => {
          el.setAttribute("data-preview-hover", "");
          if (!el.matches(".node, .cluster")) return;
          const shapes = el.querySelectorAll<SVGElement>(
            el.classList.contains("cluster")
              ? ":scope > rect"
              : "rect, path, polygon, circle, ellipse",
          );
          for (const shape of shapes) {
            if (shape.closest(".label, foreignObject")) continue;
            const fill = getComputedStyle(shape).fill;
            shapeStyles.set(shape, shape.getAttribute("style"));
            // Mermaid classes can set inline !important styles. Override them
            // temporarily and restore the exact original style on pointer exit.
            shape.style.setProperty("stroke", "#3b82f6", "important");
            shape.style.setProperty("stroke-width", "3px", "important");
            shape.style.setProperty(
              "vector-effect",
              "non-scaling-stroke",
              "important",
            );
            if (fill !== "none")
              shape.style.setProperty(
                "fill",
                `color-mix(in srgb, ${fill} 75%, #3b82f6)`,
                "important",
              );
          }
        });
      }
    };
    root.addEventListener("pointerover", onPointerOver);
    const onPointerOut = (event: Event) => {
      const related = (event as PointerEvent).relatedTarget;
      if (!(related instanceof Node) || !root.contains(related)) clearHover();
    };
    root.addEventListener("pointerout", onPointerOut);
    if (fittedDoc.current !== docId) {
      fittedDoc.current = docId;
      fit();
    } else {
      syncSvgSize();
      applyTransform();
    }
    return () => {
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
    };
  }, [svg, docId, source]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
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
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
          line:
            Number(
              (
                e.nativeEvent
                  .composedPath()
                  .find(
                    (el) =>
                      el instanceof Element &&
                      el.hasAttribute("data-source-line"),
                  ) as Element | undefined
              )?.getAttribute("data-source-line"),
            ) || undefined,
          x: e.clientX - view.current.x,
          y: e.clientY - view.current.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4)
          d.moved = true;
        if (!d.moved) return;
        view.current.x = e.clientX - d.x;
        view.current.y = e.clientY - d.y;
        scheduleTransform();
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && d.line) onNavigate?.(d.line);
      }}
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
