import mermaid from "mermaid";
import DOMPurify from "dompurify";
import mermaidPackage from "mermaid/package.json";
export const mermaidVersion = mermaidPackage.version;
let queue = Promise.resolve();
let sequence = 0;
let fonts: Promise<unknown> | undefined;
let initializedTheme: string | undefined;
export function renderDiagram(code: string, theme: string): Promise<string> {
  const task = queue.then(async () => {
    fonts ??= document.fonts
      .load("16px Inter")
      .then(() => document.fonts.ready)
      .catch((e) => {
        fonts = undefined;
        throw e;
      });
    await fonts;
    // mermaid.render() resets to this site config, so diagram directives never leak.
    if (initializedTheme !== theme) {
      initializedTheme = theme;
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
    }
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
