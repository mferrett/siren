import mermaid from "mermaid";
import DOMPurify from "dompurify";
import mermaidPackage from "mermaid/package.json";
export const mermaidVersion = mermaidPackage.version;
let queue = Promise.resolve();
let sequence = 0;
export function renderDiagram(code: string, theme: string): Promise<string> {
  const task = queue.then(async () => {
    await document.fonts.load("16px Inter");
    await document.fonts.ready;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme as "default",
      fontFamily: "Inter, sans-serif",
      suppressErrorRendering: true,
      maxTextSize: 100000,
      maxEdges: 1500,
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "maxEdges",
        "suppressErrorRendering",
      ],
    });
    const { svg } = await mermaid.render(`diagram-${++sequence}`, code);
    return DOMPurify.sanitize(svg, {
      ADD_TAGS: ["foreignObject"],
      HTML_INTEGRATION_POINTS: { foreignobject: true },
      ADD_ATTR: ["dominant-baseline"],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "image", "a"],
      FORBID_ATTR: ["href", "xlink:href"],
    });
  });
  queue = task.then(
    () => {},
    () => {},
  );
  return task;
}
