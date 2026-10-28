import { jsPDF } from "jspdf";
import "svg2pdf.js";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import fontDataUrl from "@fontsource/inter/files/inter-latin-400-normal.woff2?inline";
import { desktop, saveBytes } from "./native";
export interface ExportOptions {
  scale: number;
  background: string;
  transparent: boolean;
  orientation: "landscape" | "portrait";
  page: "a4" | "letter";
  fit: boolean;
}
export const defaultExport: ExportOptions = {
  scale: 2,
  background: "#ffffff",
  transparent: false,
  orientation: "landscape",
  page: "a4",
  fit: true,
};
export function svgElement(svg: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svg, "text/html");
  const el = (doc.querySelector("svg") ??
    doc.documentElement) as unknown as SVGSVGElement;
  el.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  el.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  const view = el
    .getAttribute("viewBox")
    ?.trim()
    .split(/[ ,]+/)
    .map(Number);
  el.setAttribute(
    "width",
    String(view?.[2] || parseFloat(el.getAttribute("width") || "800") || 800),
  );
  el.setAttribute(
    "height",
    String(view?.[3] || parseFloat(el.getAttribute("height") || "600") || 600),
  );
  el.style.maxWidth = "none";
  return el;
}
async function embeddedSvg(svg: string) {
  const el = svgElement(svg);
  let data = fontDataUrl;
  if (!data.startsWith("data:")) {
    const blob = await (await fetch(data)).blob();
    data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `@font-face{font-family:Inter;src:url('${data}') format('woff2');font-weight:400;}`;
  el.prepend(style);
  return new XMLSerializer().serializeToString(el);
}
/** Convert Mermaid HTML labels into SVG text before canvas/PDF; multiline retained. */
export function portableSvg(svg: string): string {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  const shadow = host.attachShadow({ mode: "open" });
  const el = svgElement(svg);
  shadow.append(el);
  document.body.append(host);
  try {
    for (const foreign of Array.from(el.querySelectorAll("foreignObject"))) {
      const content = foreign.querySelector("span,div") ?? foreign;
      const style = getComputedStyle(content);
      const fontSize = parseFloat(style.fontSize) || 16;
      const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.5;
      const width = Number(foreign.getAttribute("width") || 0),
        height = Number(foreign.getAttribute("height") || 0);
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
      const clone = foreign.cloneNode(true) as Element;
      for (const br of Array.from(clone.querySelectorAll("br"))) {
        br.replaceWith("\n");
      }
      const rawLines = (clone.textContent ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const lines: string[] = [];
      for (const raw of rawLines) {
        let line = "";
        for (const word of raw.split(/\s+/)) {
          const next = line ? line + " " + word : word;
          if (line && width > 0 && ctx.measureText(next).width > width + 1) {
            lines.push(line);
            line = word;
          } else line = next;
        }
        if (line) lines.push(line);
      }
      const text = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      const x = Number(foreign.getAttribute("x") || 0) + width / 2;
      text.setAttribute("x", String(x));
      text.setAttribute(
        "y",
        String(
          Number(foreign.getAttribute("y") || 0) +
            height / 2 -
            ((lines.length - 1) * lineHeight) / 2,
        ),
      );
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("stroke", "none");
      text.setAttribute("stroke-width", "0");
      text.setAttribute("fill", style.color);
      text.setAttribute("font-family", style.fontFamily);
      text.setAttribute("font-size", style.fontSize);
      const weight = parseInt(style.fontWeight, 10);
      text.setAttribute(
        "font-weight",
        style.fontWeight === "bold" || weight >= 600 ? "bold" : "normal",
      );
      text.setAttribute("font-style", style.fontStyle);
      for (const [i, line] of lines.entries()) {
        const span = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "tspan",
        );
        span.setAttribute("x", String(x));
        span.setAttribute("dy", i ? String(lineHeight) : "0");
        span.textContent = line;
        text.append(span);
      }
      foreign.replaceWith(text);
    }
    return new XMLSerializer().serializeToString(el);
  } finally {
    host.remove();
  }
}
async function raster(
  svg: string,
  options: ExportOptions,
  maxPixels = 64_000_000,
): Promise<HTMLCanvasElement> {
  const source = await embeddedSvg(portableSvg(svg));
  const el = svgElement(source);
  const w = Math.max(1, Number(el.getAttribute("width")) || 800),
    h = Math.max(1, Number(el.getAttribute("height")) || 600);
  const maxSide = 16384;
  const scale = Math.min(
    options.scale,
    maxSide / Math.max(w, h, 1),
    Math.sqrt(maxPixels / Math.max(w * h, 1)),
  );
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () =>
      reject(new Error("Unable to load SVG image for rendering."));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w * scale));
  canvas.height = Math.max(1, Math.ceil(h * scale));
  const ctx = canvas.getContext("2d")!;
  if (!options.transparent) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}
export async function exportDiagram(
  svg: string,
  name: string,
  format: "svg" | "png" | "pdf",
  options: ExportOptions,
) {
  let bytes: Uint8Array;
  if (format === "svg")
    bytes = new TextEncoder().encode(await embeddedSvg(svg));
  else if (format === "png") {
    const canvas = await raster(svg, options);
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error("PNG unavailable"))),
        "image/png",
      ),
    );
    bytes = new Uint8Array(await blob.arrayBuffer());
  } else {
    const el = svgElement(portableSvg(svg));
    for (const t of Array.from(el.querySelectorAll("text,tspan"))) {
      t.setAttribute("font-family", "helvetica");
      t.setAttribute("stroke", "none");
      (t as SVGElement).style.removeProperty("stroke");
      (t as SVGElement).style.removeProperty("stroke-width");
      (t as SVGElement).style.fontFamily = "helvetica";
    }
    const pdf = new jsPDF({
      orientation: options.orientation,
      format: options.page,
      unit: "pt",
    });
    const w = Number(el.getAttribute("width")),
      h = Number(el.getAttribute("height"));
    const pw = pdf.internal.pageSize.getWidth(),
      ph = pdf.internal.pageSize.getHeight();
    const ratio = options.fit ? Math.min((pw - 40) / w, (ph - 40) / h) : 1;
    if (!options.transparent) {
      pdf.setFillColor(options.background);
      pdf.rect(0, 0, pw, ph, "F");
    }
    await pdf.svg(el, { x: 20, y: 20, width: w * ratio, height: h * ratio });
    bytes = new Uint8Array(pdf.output("arraybuffer"));
  }
  return saveBytes(
    `${name.replace(/\.(mmd|mermaid)$/i, "")}.${format}`,
    bytes,
    format,
  );
}
export async function copyDiagram(svg: string, options: ExportOptions) {
  const canvas = await raster(svg, options, 25_000_000);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob(
      (b) => (b ? res(b) : rej(new Error("PNG unavailable"))),
      "image/png",
    ),
  );
  if (desktop) {
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    const img = await TauriImage.fromBytes(pngBytes);
    try {
      await writeImage(img);
    } finally {
      await img.close();
    }
  } else {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }
}
