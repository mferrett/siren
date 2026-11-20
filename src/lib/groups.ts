/** A deliberately bounded flowchart parser. Unsupported syntax fails closed. */
export interface Group {
  id: string;
  label: string;
  parent?: string;
  members: Set<string>;
}
type Node = { id: string; raw: string };
type Statement =
  | { kind: "raw"; raw: string; owner?: string }
  | { kind: "group"; id: string; raw: string; owner?: string }
  | { kind: "end"; id: string }
  | { kind: "class"; ids: string[]; cls: string; owner?: string }
  | { kind: "style"; id: string; raw: string; owner?: string }
  | {
      kind: "nodes";
      groups: Node[][];
      edges: string[];
      raw: string;
      owner?: string;
    };
const EDGE_TEXT =
  /^(?:[A-Za-z_][\w-]*@)?[<ox]?(?:--|==|-\.)\s+.+?\s+(?:-{2,}[>ox-]?|={2,}[>ox]?|\.-[>ox]?)(?=\s)\s*/;
const EDGE_PLAIN =
  /^(?:[A-Za-z_][\w-]*@)?[<ox]?(?:-{2,}[>ox-]?|={2,}[>ox]?|-\.+-[>ox]?|~{3,})(?:\|[^|\n]*\|)?\s*/;
export function groupMetadata(source: string): { id: string; label: string }[] {
  return Array.from(
    source.matchAll(/^\s*%%\s*@collapse\s+id=([\w-]+)\s+label="([^"]+)"\s*$/gm),
    (m) => ({ id: m[1], label: m[2] }),
  );
}
function nodeAt(s: string): [Node, string] {
  const m = s.match(/^([A-Za-z_][\w-]*)/);
  if (!m) throw new Error(`Unrecognized node: ${s}`);
  let i = m[0].length;
  const stack: string[] = [];
  let quote = false;
  while (i < s.length) {
    const c = s[i];
    if (!stack.length && !"[({".includes(c)) break;
    if (c === '"' && s[i - 1] !== "\\") quote = !quote;
    if (!quote) {
      if ("[({".includes(c)) stack.push(c);
      if ("])}".includes(c)) {
        const op = stack.pop();
        if (
          op !== ({ "]": "[", ")": "(", "}": "{" } as Record<string, string>)[c]
        )
          throw new Error("Unsupported node shape");
      }
    }
    i++;
  }
  if (stack.length || quote)
    throw new Error("Multiline labels are not supported for group collapsing");
  const cls = s.slice(i).match(/^:::[\w-]+/);
  if (cls) i += cls[0].length;
  const shape = s.slice(i).match(/^@\{[^}]*\}/);
  if (shape) i += shape[0].length;
  return [{ id: m[1], raw: s.slice(0, i) }, s.slice(i).trim()];
}
function endpointsAt(s: string): [Node[], string] {
  const group: Node[] = [];
  let rest = s;
  for (;;) {
    let n: Node;
    [n, rest] = nodeAt(rest);
    group.push(n);
    if (!rest.startsWith("&")) return [group, rest];
    rest = rest.slice(1).trim();
  }
}
function parse(source: string, navigation = false) {
  const groups = new Map<string, Group>();
  const statements: (Statement & { line: number })[] = [];
  // Attach source locations without changing the bounded grammar.
  const add = (st: Statement) => statements.push({ ...st, line: sourceLine });
  let sourceLine = 1;
  const stack: string[] = [];
  let frontmatter = false;
  let header = false;
  for (const [idx, line] of source.split("\n").entries()) {
    sourceLine = idx + 1;
    const s = line.trim();
    const owner = stack.at(-1);
    if (s === "---" && (idx === 0 || frontmatter)) {
      frontmatter = !frontmatter;
      add({ kind: "raw", raw: line });
      continue;
    }
    if (frontmatter || !s || s.startsWith("%%")) {
      add({ kind: "raw", raw: line, owner });
      continue;
    }
    if (!header) {
      if (!/^(flowchart|graph)\s+(TB|TD|BT|LR|RL)\s*$/.test(s))
        throw new Error(
          "Group collapsing is only available for flowcharts with an explicit direction.",
        );
      header = true;
      add({ kind: "raw", raw: line });
      continue;
    }
    const sg = s.match(/^subgraph\s+([A-Za-z_][\w-]*)(?:\s*\[.*\])?\s*$/);
    if (sg) {
      if (groups.has(sg[1])) throw new Error("Duplicate group ID");
      groups.set(sg[1], {
        id: sg[1],
        label: sg[1],
        parent: owner,
        members: new Set(),
      });
      add({ kind: "group", id: sg[1], raw: line, owner });
      stack.push(sg[1]);
      continue;
    }
    if (s === "end") {
      const id = stack.pop();
      if (!id) throw new Error("end without subgraph");
      add({ kind: "end", id });
      continue;
    }
    if (/^(direction\s+(TB|TD|BT|LR|RL)|classDef\s+.+)$/.test(s)) {
      add({ kind: "raw", raw: line, owner });
      continue;
    }
    if (navigation && /^(linkStyle|click)\s/.test(s)) {
      add({ kind: "raw", raw: line, owner });
      continue;
    }
    if (/^(linkStyle|click)\s/.test(s))
      throw new Error(
        "Group collapsing: linkStyle and click statements are not supported.",
      );
    const cm = s.match(/^class\s+(\S+)\s+([\w-]+)$/);
    if (cm) {
      add({
        kind: "class",
        ids: cm[1].split(","),
        cls: cm[2],
        owner,
      });
      continue;
    }
    const sm = s.match(/^style\s+([A-Za-z_][\w-]*)\s+.+$/);
    if (sm) {
      add({ kind: "style", id: sm[1], raw: line, owner });
      continue;
    }
    if (/^(style|class)\s/.test(s))
      throw new Error(
        `Group collapsing: unsupported syntax at line ${idx + 1}.`,
      );
    const groupsList: Node[][] = [];
    const edges: string[] = [];
    let rest = s;
    let n: Node[];
    [n, rest] = endpointsAt(rest);
    groupsList.push(n);
    while (rest) {
      const edge = rest.match(EDGE_TEXT) ?? rest.match(EDGE_PLAIN);
      if (!edge)
        throw new Error(
          `Group collapsing: unsupported syntax at line ${idx + 1}. Use one statement per line.`,
        );
      edges.push(edge[0].trim());
      rest = rest.slice(edge[0].length);
      [n, rest] = endpointsAt(rest);
      groupsList.push(n);
    }
    const nodes = groupsList.flat();
    for (const id of stack)
      for (const node of nodes) {
        // Only declarations establish membership; bare endpoints may reference outer nodes.
        if (node.raw !== node.id || nodes.length === 1)
          groups.get(id)!.members.add(node.id);
      }
    add({
      kind: "nodes",
      groups: groupsList,
      edges,
      raw: line,
      owner,
    });
  }
  if (stack.length) throw new Error("Unclosed group");
  // Mermaid assigns previously unseen bare nodes to their declaring subgraph.
  const declared = new Set<string>();
  for (const st of statements)
    if (st.kind === "nodes")
      for (const n of st.groups.flat()) {
        if (!declared.has(n.id) && st.owner) {
          let g: Group | undefined = groups.get(st.owner);
          while (g) {
            g.members.add(n.id);
            g = g.parent ? groups.get(g.parent) : undefined;
          }
        }
        declared.add(n.id);
      }
  return { groups, statements };
}
export function collapseFlowchart(
  source: string,
  collapsed: string[],
  sourceLines?: number[],
): string {
  const metadata = collapsed.length ? groupMetadata(source) : [];
  const active = new Set(metadata.filter((m) => collapsed.includes(m.id)).map((m) => m.id));
  if (!active.size) {
    sourceLines?.push(...source.split("\n").map((_, i) => i + 1));
    return source;
  }
  const { groups, statements } = parse(source);
  for (const id of active)
    if (!groups.has(id)) throw new Error(`Group ${id} not found`);
  function hidden(id?: string): string | undefined {
    let result: string | undefined;
    while (id) {
      if (active.has(id)) result = id;
      id = groups.get(id)?.parent;
    }
    return result;
  }
  function target(id: string) {
    let result = id;
    for (const g of groups.values())
      if (g.members.has(id) && hidden(g.id)) {
        result = hidden(g.id)!;
        break;
      }
    return hidden(id) ?? result;
  }
  const out: string[] = [];
  let outputLine = 1;
  const emit = (text: string) => {
    out.push(text);
    sourceLines?.push(outputLine);
  };
  for (const st of statements) {
    outputLine = st.line;
    if (st.kind === "raw") {
      if (!hidden(st.owner)) emit(st.raw);
    }
    if (st.kind === "group") {
      if (!hidden(st.owner)) {
        if (active.has(st.id)) {
          const label = metadata
            .find((m) => m.id === st.id)!
            .label.replaceAll('"', "&quot;");
          emit(`${st.id}["${label}"]`);
        } else emit(st.raw);
      }
    }
    if (st.kind === "end") {
      if (!hidden(st.id)) emit("end");
    }
    if (st.kind === "class") {
      const ids = st.ids.filter((id) => target(id) === id);
      if (!hidden(st.owner) && ids.length)
        emit(`class ${ids.join(",")} ${st.cls}`);
    }
    if (st.kind === "style") {
      if (!hidden(st.owner) && target(st.id) === st.id) emit(st.raw);
    }
    if (st.kind === "nodes") {
      const all = st.groups.flat();
      const unchanged = all.every((n) => target(n.id) === n.id);
      if (!st.edges.length) {
        // Declarations of collapsed members may live outside the subgraph block.
        if (!hidden(st.owner) && unchanged) emit(st.raw);
        continue;
      }
      if (!hidden(st.owner) && unchanged) {
        emit(st.raw);
        continue;
      }
      const seen = new Set<string>();
      for (let i = 0; i < st.edges.length; i++)
        for (const a of st.groups[i])
          for (const b of st.groups[i + 1]) {
            const ta = target(a.id),
              tb = target(b.id);
            if (ta === tb && (ta !== a.id || tb !== b.id)) continue;
            const edge = `${ta === a.id ? a.raw : ta} ${st.edges[i]} ${tb === b.id ? b.raw : tb}`;
            // Crossing edges must live outside a removed subgraph.
            if (hidden(st.owner) && ta === tb) continue;
            if (!seen.has(edge)) {
              seen.add(edge);
              emit(edge);
            }
          }
    }
  }
  return out.join("\n");
}

/** Locations for the flowchart elements emitted by Mermaid. Unsupported grammar
 * leaves navigation unavailable rather than guessing an unrelated source line. */
export function flowchartLocations(source: string, lines?: number[]) {
  const nodes: Record<string, number> = {};
  const edges: Record<string, number> = {};
  try {
    // Split statements only outside labels, retaining the original line numbers.
    const chunks: string[] = [],
      originalLines: number[] = [];
    let chunk = "",
      lineNumber = 1,
      startLine = 1,
      depth = 0,
      quote = false,
      pipe = false,
      comment = false;
    for (let i = 0; i <= source.length; i++) {
      const c = source[i] ?? "\n";
      if (c === "%" && source[i + 1] === "%" && !quote) comment = true;
      if (!comment) {
        if (c === '"' && source[i - 1] !== "\\") quote = !quote;
        if (!quote) {
          if ("[({".includes(c)) depth++;
          if ("])}".includes(c)) depth--;
          if (c === "|" && !depth) pipe = !pipe;
        }
      }
      if (
        (c === "\n" && ((!depth && !quote) || comment)) ||
        (c === ";" && !depth && !quote && !pipe && !comment)
      ) {
        chunks.push(chunk);
        originalLines.push(startLine);
        chunk = "";
        if (c === "\n") lineNumber++;
        startLine = lineNumber;
        comment = false;
      } else {
        chunk += c === "\n" ? " " : c;
        if (c === "\n") lineNumber++;
      }
    }
    const { statements } = parse(chunks.join("\n"), true);
    const counts = new Map<string, number>();
    const declared = new Set<string>();
    for (const st of statements) {
      const originalLine = originalLines[st.line - 1];
      const line = lines?.[originalLine - 1] ?? originalLine;
      if (st.kind === "group") nodes[st.id] ??= line;
      if (st.kind !== "nodes") continue;
      for (const n of st.groups.flat()) {
        nodes[n.id] ??= line;
        if (!declared.has(n.id) && (n.raw !== n.id || !st.edges.length)) {
          nodes[n.id] = line;
          declared.add(n.id);
        }
      }
      for (let i = 0; i < st.edges.length; i++)
        for (const a of st.groups[i])
          for (const b of st.groups[i + 1]) {
            const pair = JSON.stringify([a.id, b.id]);
            const count = counts.get(pair) ?? 0;
            counts.set(pair, count + 1);
            const explicit = st.edges[i].match(/^([\w-]+)@/)?.[1];
            edges[explicit ?? `L_${a.id}_${b.id}_${count ? count + 1 : 0}`] =
              line;
          }
    }
  } catch {
    return { nodes: {}, edges: {} };
  }
  return { nodes, edges };
}
