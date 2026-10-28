export interface Diagram {
  id: string;
  name: string;
  code: string;
  savedCode: string;
  collapsed: string[];
  modified: number;
  opened: number;
  path?: string;
  externalText?: string;
}
export interface Archive {
  version: 1;
  documents: Diagram[];
  active: string;
  openTabs?: string[];
  splitRatio?: number;
  theme: "light" | "dark";
  mermaidTheme: string;
  debounce: number;
  autosave: boolean;
}
export const examples: Record<string, string> = {
  "Flowchart · groups": `flowchart TB
    %% @collapse id=PAS label="PAS System"
    subgraph PAS["PAS System"]
        API["PAS API"]
        Service["Request Service"]
        DB[("PAS Database")]
        API --> Service
        Service --> DB
    end
    Client["Client"] --> API`,
  Sequence: `sequenceDiagram
    actor User
    User->>App: Open diagram
    App->>Workspace: Load document
    Workspace-->>App: Mermaid code
    App-->>User: Preview`,
  Class: `classDiagram
    class Diagram {
      +String name
      +String code
      +save()
    }
    Workspace "1" --> "*" Diagram`,
  State: `stateDiagram-v2
    [*] --> Draft
    Draft --> Saved: Save
    Saved --> Draft: Edit`,
  "Entity Relationship": `erDiagram
    WORKSPACE ||--o{ DIAGRAM : contains
    DIAGRAM {
      string name
      string code
    }`,
  Gantt: `gantt
    title Project Plan
    dateFormat YYYY-MM-DD
    section Product
    Analysis :a, 2026-01-01, 3d
    Development :after a, 7d`,
  Mindmap: `mindmap
  root((Diagrams))
    Ideas
    Architecture
    Processes`,
  Pie: `pie title Diagram Types
    "Flowchart" : 45
    "Sequence" : 35
    "Other" : 20`,
  "Theme & Frontmatter": `---
config:
  theme: base
  look: handDrawn
  fontFamily: Inter
  themeVariables:
    primaryColor: '#d7f4e5'
    primaryTextColor: '#16352a'
---
flowchart LR
    A[Idea] --> B[Diagram]
    B --> C[Share]`,
};
export function createDiagram(
  name = "Untitled",
  code = Object.values(examples)[0],
): Diagram {
  return {
    id: crypto.randomUUID(),
    name,
    code,
    savedCode: code,
    collapsed: [],
    modified: Date.now(),
    opened: Date.now(),
  };
}
export function initialArchive(): Archive {
  const d = createDiagram("My First Diagram");
  return {
    version: 1,
    documents: [d],
    active: d.id,
    openTabs: [d.id],
    splitRatio: 48,
    theme: "light",
    mermaidTheme: "default",
    debounce: 450,
    autosave: true,
  };
}
export function parseArchive(text: string): Archive {
  const a = JSON.parse(text) as Archive;
  if (
    a.version !== 1 ||
    !Array.isArray(a.documents) ||
    a.documents.some(
      (d) =>
        typeof d.id !== "string" ||
        typeof d.name !== "string" ||
        typeof d.code !== "string" ||
        typeof d.savedCode !== "string" ||
        !Array.isArray(d.collapsed),
    )
  )
    throw new Error("Invalid workspace archive format");
  return a;
}
export function markdownBlocks(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let fence: string | undefined;
  let size = 0;
  let code: string[] = [];
  for (const line of lines) {
    if (!fence) {
      const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*mermaid\s*$/i);
      if (m) {
        fence = m[1][0];
        size = m[1].length;
        code = [];
      }
    } else if (new RegExp(`^ {0,3}${fence}{${size},}\\s*$`).test(line)) {
      blocks.push(code.join("\n"));
      fence = undefined;
    } else code.push(line);
  }
  return blocks;
}
export function importedDiagrams(path: string, text: string): Diagram[] {
  const name = path.split(/[/\\]/).pop() || "Imported";
  const md = /\.md$/i.test(path);
  if (!/\.(mmd|mermaid|md)$/i.test(path))
    throw new Error("Unsupported format: choose .mmd, .mermaid, or .md");
  const codes = md ? markdownBlocks(text) : [text];
  if (!codes.length)
    throw new Error("No Mermaid blocks found in the Markdown file.");
  return codes.map((code, i) => ({
    ...createDiagram(md ? `${name} · block ${i + 1}` : name, code),
    ...(md ? {} : { path, externalText: text }),
  }));
}
