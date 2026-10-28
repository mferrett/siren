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
  | { kind: "nodes"; nodes: Node[]; edges: string[]; owner?: string };
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
  return [{ id: m[1], raw: s.slice(0, i) }, s.slice(i).trim()];
}
function parse(source: string) {
  const groups = new Map<string, Group>();
  const statements: Statement[] = [];
  const stack: string[] = [];
  let frontmatter = false;
  let header = false;
  for (const [idx, line] of source.split("\n").entries()) {
    const s = line.trim();
    const owner = stack.at(-1);
    if (s === "---" && (idx === 0 || frontmatter)) {
      frontmatter = !frontmatter;
      statements.push({ kind: "raw", raw: line });
      continue;
    }
    if (frontmatter || !s || s.startsWith("%%")) {
      statements.push({ kind: "raw", raw: line, owner });
      continue;
    }
    if (!header) {
      if (!/^(flowchart|graph)\s+(TB|TD|BT|LR|RL)\s*$/.test(s))
        throw new Error(
          "Group collapsing is only available for flowcharts with an explicit direction.",
        );
      header = true;
      statements.push({ kind: "raw", raw: line });
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
      statements.push({ kind: "group", id: sg[1], raw: line, owner });
      stack.push(sg[1]);
      continue;
    }
    if (s === "end") {
      const id = stack.pop();
      if (!id) throw new Error("end without subgraph");
      statements.push({ kind: "end", id });
      continue;
    }
    if (/^(direction\s+(TB|TD|BT|LR|RL)|classDef\s+.+)$/.test(s)) {
      statements.push({ kind: "raw", raw: line, owner });
      continue;
    }
    if (/^(style|class|linkStyle|click)\b/.test(s))
      throw new Error(
        "Group collapsing: standalone style, class, linkStyle, and click statements are not supported; use classDef and :::class on nodes.",
      );
    const nodes: Node[] = [];
    const edges: string[] = [];
    let rest = s;
    let n: Node;
    [n, rest] = nodeAt(rest);
    nodes.push(n);
    while (rest) {
      const edge = rest.match(
        /^(?:<-->|-->|---|-.->|==>|--o|--x)(?:\|[^|\n]*\|)?\s*/,
      );
      if (!edge)
        throw new Error(
          `Group collapsing: unsupported syntax at line ${idx + 1}. Use one statement per line and A -->|label| B links.`,
        );
      edges.push(edge[0].trim());
      rest = rest.slice(edge[0].length);
      [n, rest] = nodeAt(rest);
      nodes.push(n);
    }
    for (const id of stack)
      for (const node of nodes) {
        // Only declarations establish membership; bare endpoints may reference outer nodes.
        if (node.raw !== node.id || nodes.length === 1)
          groups.get(id)!.members.add(node.id);
      }
    statements.push({ kind: "nodes", nodes, edges, owner });
  }
  if (stack.length) throw new Error("Unclosed group");
  // Mermaid assigns previously unseen bare nodes to their declaring subgraph.
  const declared = new Set<string>();
  for (const st of statements)
    if (st.kind === "nodes")
      for (const n of st.nodes) {
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
export function collapseFlowchart(source: string, collapsed: string[]): string {
  if (!collapsed.length) return source;
  const metadata = groupMetadata(source);
  const { groups, statements } = parse(source);
  const active = new Set(
    collapsed.filter((id) => metadata.some((m) => m.id === id)),
  );
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
  for (const st of statements) {
    if (st.kind === "raw") {
      if (!hidden(st.owner)) out.push(st.raw);
    }
    if (st.kind === "group") {
      if (!hidden(st.owner)) {
        if (active.has(st.id)) {
          const label = metadata
            .find((m) => m.id === st.id)!
            .label.replaceAll('"', "&quot;");
          out.push(`${st.id}["${label}"]`);
        } else out.push(st.raw);
      }
    }
    if (st.kind === "end") {
      if (!hidden(st.id)) out.push("end");
    }
    if (st.kind === "nodes") {
      if (!st.edges.length) {
        if (!hidden(st.owner)) out.push(st.nodes[0].raw);
        continue;
      }
      for (let i = 0; i < st.edges.length; i++) {
        const a = st.nodes[i],
          b = st.nodes[i + 1],
          ta = target(a.id),
          tb = target(b.id);
        if (ta === tb && (ta !== a.id || tb !== b.id)) continue;
        const edge = `${ta === a.id ? a.raw : ta} ${st.edges[i]} ${tb === b.id ? b.raw : tb}`;
        // Crossing edges must live outside a removed subgraph.
        if (hidden(st.owner)) {
          if (ta !== tb) out.push(edge);
        } else out.push(edge);
      }
    }
  }
  return out.join("\n");
}
