import { flowchartLocations } from "./groups";

export type PreviewSource = { code: string; originalLines: number[] };
type Row = { text: string; line: number };

function bind(el: Element | null, line?: number, target = `line:${line}`) {
  if (!el || !Number.isInteger(line)) return;
  el.setAttribute("data-source-line", String(line));
  el.setAttribute("data-preview-target", target);
}

// Mermaid draws the stroke and its label separately. Give both the same target,
// and make thin strokes easier to click without changing the exported SVG.
function bindEdge(el: Element, line: number | undefined, target: string) {
  if (!line) return;
  bind(el, line, target);
  if (!el.matches("path,line,polyline")) return;
  const hit = el.cloneNode(false) as SVGElement;
  for (const attr of ["id", "marker-start", "marker-mid", "marker-end"])
    hit.removeAttribute(attr);
  hit.classList.add("preview-edge-hit");
  hit.setAttribute(
    "style",
    "fill:none;stroke:transparent;stroke-width:14px;pointer-events:stroke;cursor:pointer",
  );
  el.after(hit);
}

function bindGraphEdges(svg: SVGSVGElement, edges: Map<string, number>) {
  for (const el of svg.querySelectorAll("[data-id]")) {
    const id = el.getAttribute("data-id")!;
    bindEdge(el, edges.get(id), `edge:${id}`);
  }
}

function flowchart(svg: SVGSVGElement, source: PreviewSource) {
  const { nodes, edges } = flowchartLocations(
    source.code,
    source.originalLines,
  );
  for (const el of svg.querySelectorAll(".node, .rough-node, .cluster")) {
    const id =
      el.getAttribute("data-id") ??
      (el.matches(".cluster")
        ? el.id.slice(svg.id.length + 1)
        : el.id.replace(/^.*?flowchart-/, "").replace(/-\d+$/, ""));
    bind(el, nodes[id], `node:${id}`);
  }
  bindGraphEdges(svg, new Map(Object.entries(edges)));
}

// Keep line numbers from the editor while omitting YAML, comments and whitespace.
function sourceRows({ code, originalLines }: PreviewSource): Row[] {
  const rows: Row[] = [];
  let yaml = false;
  for (const [i, raw] of code.split("\n").entries()) {
    const text = raw.trim();
    if (text === "---" && (!i || yaml)) {
      yaml = !yaml;
    } else if (!yaml && text && !text.startsWith("%%")) {
      rows.push({ text, line: originalLines[i] ?? i + 1 });
    }
  }
  return rows;
}

function sequence(svg: SVGSVGElement, rows: Row[]) {
  const actors = new Map<string, number>();
  const messages: { from: string; to: string; line: number }[] = [];
  const notes: number[] = [];
  for (const { text, line } of rows) {
    const actor = text.match(
      /^(?:create\s+)?(?:participant|actor)\s+([^\s@]+)/i,
    );
    if (actor) actors.set(actor[1], line);
    else if (/^note\s/i.test(text)) notes.push(line);
    else {
      const msg = text.match(
        /^([^\s:]+?)\s*(?:<<)?--?[><x()\\/|]+[-+]?\s*([^\s:]+)\s*:/,
      );
      if (!msg) continue;
      const [, from, to] = msg;
      messages.push({ from, to, line });
      if (!actors.has(from)) actors.set(from, line);
      if (!actors.has(to)) actors.set(to, line);
    }
  }
  for (const el of svg.querySelectorAll(
    '[data-et="participant"],[data-et="life-line"],.actor-bottom[name]',
  )) {
    const id = el.getAttribute("data-id") ?? el.getAttribute("name")!;
    const target = el.matches("rect.actor-bottom") ? el.parentElement : el;
    bind(target, actors.get(id), `actor:${id}`);
  }
  const arrows = svg.querySelectorAll('[data-et="message"]');
  if (arrows.length === messages.length)
    arrows.forEach((el, i) => {
      const { from, to, line } = messages[i];
      if (
        el.getAttribute("data-from") !== from ||
        el.getAttribute("data-to") !== to
      )
        return;
      const target = `message:${i}`;
      for (
        let label = el.previousElementSibling;
        label?.matches(".messageText");
        label = label.previousElementSibling
      )
        bind(label, line, target);
      bindEdge(el, line, target);
    });
  const boxes = svg.querySelectorAll('[data-et="note"]');
  if (boxes.length === notes.length)
    boxes.forEach((el, i) => bind(el, notes[i]));
}

// Capture the source and destination identifiers, including quoted ER names
// and UML multiplicities such as Workspace "1" --> "*" Diagram.
const graphSyntax = {
  classDiagram: {
    relation:
      /^(\S+?)\s*(?:"[^"]*"\s*)?[<|>*o()]*[-.]{2}[|>*o()<]*\s*(?:"[^"]*"\s*)?([^\s:]+)/,
    declaration: /^class\s+([^\s[{~]+)/,
  },
  er: {
    relation:
      /^("[^"]+"|\S+)\s+[|o}{01]+(?:--|\.\.)[|o}{01]+\s+("[^"]+"|[^\s:]+)/,
    declaration: /^(?:"([^"]+)"|([\w-]+))\s*(?:\[[^\]]*\]\s*)?\{$/,
  },
  stateDiagram: {
    relation: /^(\S+?)\s*-->\s*([^\s:]+)/,
    declaration: /^(?:state\s+(?:"[^"]+"\s+as\s+)?([^\s{]+)|([^\s:]+)\s*:)/,
  },
};

function graph(
  svg: SVGSVGElement,
  rows: Row[],
  type: keyof typeof graphSyntax,
) {
  const nodes = new Map<string, number>();
  const relations: number[] = [];
  const members = new Map<string, Row[]>();
  const scopes: string[] = [];
  const { relation, declaration } = graphSyntax[type];
  for (const row of rows) {
    const { text, line } = row;
    const edge = text.match(relation);
    if (edge) {
      relations.push(line);
      for (const [i, raw] of edge.slice(1).entries()) {
        const id =
          raw === "[*]"
            ? `${scopes.at(-1) ?? "root"}_${i ? "end" : "start"}`
            : raw.replace(/^"|"$/g, "");
        if (!nodes.has(id)) nodes.set(id, line);
      }
      continue;
    }
    if (text === "}") {
      scopes.pop();
      continue;
    }
    const decl = text.match(declaration);
    if (decl) {
      const id = decl[1] ?? decl[2];
      nodes.set(id, line);
      if (text.endsWith("{")) scopes.push(id);
    } else if (type !== "stateDiagram") {
      const inline =
        type === "classDiagram" && text.match(/^(\S+)\s*:\s*(.+)$/);
      const owner = inline ? inline[1] : scopes.at(-1);
      if (owner) {
        if (!members.has(owner)) members.set(owner, []);
        members.get(owner)!.push(inline ? { text: inline[2], line } : row);
        if (!nodes.has(owner)) nodes.set(owner, line);
      } else if (type === "er" && /^[\w-]+$/.test(text)) nodes.set(text, line);
    } else if (/^[\w-]+$/.test(text) && !nodes.has(text)) nodes.set(text, line);
  }
  for (const el of svg.querySelectorAll(".node, .rough-node, .cluster")) {
    const id = el.id
      .slice(svg.id.length + 1)
      .replace(/^(classId-|entity-|state-)/, "")
      .replace(/-\d+$/, "");
    bind(el, nodes.get(id), `node:${id}`);
    const body = members.get(id);
    if (!body) continue;
    for (const label of el.querySelectorAll(
      ".members-group .label, .methods-group .label",
    )) {
      const text = label.textContent.trim();
      bind(label, body.find((r) => r.text === text)?.line);
    }
    const names = el.querySelectorAll(".attribute-name");
    if (names.length === body.length) {
      for (const selector of [
        ".attribute-type",
        ".attribute-name",
        ".attribute-keys",
        ".attribute-comment",
        ".row-rect-even, .row-rect-odd",
      ])
        el.querySelectorAll(selector).forEach((cell, i) =>
          bind(cell, body[i]?.line),
        );
    }
  }
  // Mermaid numbers class and ER relationships in declaration order. State
  // transitions share their counter with notes, so sort the actual edge IDs.
  const ids = Array.from(
    svg.querySelectorAll("path[data-edge][data-id]"),
    (el) => el.getAttribute("data-id")!,
  )
    .filter((id) =>
      type === "stateDiagram" ? /^edge\d+$/.test(id) : /^id_.*_\d+$/.test(id),
    )
    .sort((a, b) => Number(a.match(/\d+$/)![0]) - Number(b.match(/\d+$/)![0]));
  if (ids.length === relations.length)
    bindGraphEdges(svg, new Map(ids.map((id, i) => [id, relations[i]])));
}

function gantt(svg: SVGSVGElement, rows: Row[]) {
  const tasks = rows.flatMap(({ text, line }) => {
    const task = text.match(/^(.+?)\s*:\s*(.+)$/);
    return task ? [{ name: task[1].trim(), spec: task[2], line }] : [];
  });
  for (const label of svg.querySelectorAll('text[id$="-text"]')) {
    const id = label.id.slice(0, -5);
    const name = label.textContent.trim();
    const candidates = tasks.filter((t) => t.name === name);
    const task =
      candidates.length === 1
        ? candidates[0]
        : candidates.find((t) =>
            t.spec
              .split(",")
              .map((s) => s.trim())
              .includes(id.slice(svg.id.length + 1)),
          );
    bind(label, task?.line);
    bind(svg.getElementById(id), task?.line);
  }
  for (const el of svg.querySelectorAll(".sectionTitle, .titleText")) {
    const keyword = el.matches(".sectionTitle") ? "section" : "title";
    bind(
      el,
      rows.find((r) => r.text === `${keyword} ${el.textContent.trim()}`)?.line,
    );
  }
}

function mindmap(svg: SVGSVGElement, rows: Row[]) {
  const items = rows.filter((r) => !r.text.startsWith("::"));
  const nodes = svg.querySelectorAll(".mindmap-node");
  if (nodes.length !== items.length) return;
  for (const el of nodes) {
    const i = el.id.match(/-node_(\d+)$/)?.[1];
    if (i) bind(el, items[Number(i)]?.line);
  }
  for (const el of svg.querySelectorAll("path[data-edge]")) {
    const id = el.getAttribute("data-id") ?? "";
    const i = id.match(/^edge_\d+_(\d+)$/)?.[1];
    if (i) bindEdge(el, items[Number(i)]?.line, id);
  }
}

function pie(svg: SVGSVGElement, rows: Row[]) {
  const sections = new Map<string, { value: number; line: number }>();
  for (const { text, line } of rows) {
    const item = text.match(/^"(.+)"\s*:\s*([\d.]+)/);
    if (item && !sections.has(item[1]))
      sections.set(item[1], { value: Number(item[2]), line });
  }
  const sum = Array.from(sections.values()).reduce(
    (s, item) => s + item.value,
    0,
  );
  const visible: number[] = [];
  for (const el of svg.querySelectorAll(".legend")) {
    const label = el.textContent.trim();
    const item =
      sections.get(label) ?? sections.get(label.replace(/ \[[\d.]+\]$/, ""));
    if (!item) continue;
    bind(el, item.line);
    // The renderer omits slices below 1% while retaining every legend entry.
    if (item.value / sum >= 0.01) visible.push(item.line);
  }
  for (const selector of [".pieCircle", ".slice"]) {
    const elements = svg.querySelectorAll(selector);
    if (elements.length === visible.length)
      elements.forEach((el, i) => bind(el, visible[i]));
  }
  bind(
    svg.querySelector(".pieTitleText"),
    rows.find((r) => /^(pie\s+.*)?title\s/i.test(r.text))?.line,
  );
}

export function bindPreviewSource(svg: SVGSVGElement, source: PreviewSource) {
  const type = svg.getAttribute("aria-roledescription");
  if (type?.startsWith("flowchart")) return flowchart(svg, source);
  const [header, ...rows] = sourceRows(source);
  switch (type) {
    case "sequence":
      return sequence(svg, rows);
    case "classDiagram":
    case "stateDiagram":
    case "er":
      return graph(svg, rows, type);
    case "gantt":
      return gantt(svg, rows);
    case "mindmap":
      return mindmap(svg, rows);
    case "pie":
      if (header) pie(svg, [header, ...rows]);
  }
}
