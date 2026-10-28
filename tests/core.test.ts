import { describe, it, expect } from "vitest";
import { collapseFlowchart, groupMetadata } from "../src/lib/groups";
import {
  examples,
  importedDiagrams,
  markdownBlocks,
  initialArchive,
  parseArchive,
} from "../src/lib/documents";
describe("Markdown import", () => {
  it("reads multiple backtick and tilde blocks without swallowing other fences", () => {
    const text =
      "Text\n```js\nx\n```\n```mermaid\nflowchart LR\n A --> B\n```\n~~~~mermaid\nsequenceDiagram\n~~~~";
    expect(markdownBlocks(text)).toEqual([
      "flowchart LR\n A --> B",
      "sequenceDiagram",
    ]);
  });
  it("imports Markdown as local copies and external Mermaid with an expected version", () => {
    expect(
      importedDiagrams("/tmp/test.md", "```mermaid\nflowchart TB\n```")[0].path,
    ).toBeUndefined();
    expect(
      importedDiagrams("C:\\Docs\\test.mmd", "flowchart TB")[0],
    ).toMatchObject({
      name: "test.mmd",
      path: "C:\\Docs\\test.mmd",
      externalText: "flowchart TB",
    });
  });
  it("rejects invalid formats and absent diagrams", () => {
    expect(() => importedDiagrams("a.js", "x")).toThrow("Unsupported format");
    expect(() => importedDiagrams("a.md", "plain")).toThrow(
      "No Mermaid blocks",
    );
  });
});
describe("Archive recovery", () => {
  it("round-trips unsaved source, last saved source and independent view state", () => {
    const a = initialArchive();
    a.documents[0].code += "\n%% draft";
    a.documents[0].collapsed = ["PAS"];
    expect(parseArchive(JSON.stringify(a))).toEqual(a);
    expect(a.documents[0].code).not.toBe(a.documents[0].savedCode);
  });
  it("does not accept corrupt data", () => {
    expect(() => parseArchive("{")).toThrow();
    expect(() => parseArchive('{"version":2,"documents":[]}')).toThrow();
  });
});
describe("Flowchart structural collapse", () => {
  it("redirects crossing edges without mutating source", () => {
    const source = examples["Flowchart · groups"];
    const result = collapseFlowchart(source, ["PAS"]);
    expect(result).toContain('PAS["PAS System"]');
    expect(result).toContain('Client["Client"] --> PAS');
    expect(result).not.toContain("API -->");
    expect(collapseFlowchart(source, [])).toBe(source);
  });
  it("preserves labelled edges and node classes", () => {
    const source =
      'flowchart LR\n%% @collapse id=G label="Group"\nsubgraph G["Group"]\n A["a --> b"]:::green\nend\nX["Outside"] -->|request| A\nclassDef green fill:#afa';
    expect(collapseFlowchart(source, ["G"])).toContain(
      'X["Outside"] -->|request| G',
    );
    expect(collapseFlowchart(source, ["G"])).toContain(
      "classDef green fill:#afa",
    );
  });
  it("maps nested groups to outermost collapsed ancestor", () => {
    const source =
      'flowchart TB\n%% @collapse id=Outer label="Outer"\n%% @collapse id=Inner label="Inner"\nsubgraph Outer["Outer"]\n O["outer node"]\n subgraph Inner["Inner"]\n I["inner node"]\n end\n O --> I\nend\nX --> I';
    const inner = collapseFlowchart(source, ["Inner"]);
    expect(inner).toContain("subgraph Outer");
    expect(inner).toContain("O --> Inner");
    expect(inner).toContain("X --> Inner");
    const both = collapseFlowchart(source, ["Outer", "Inner"]);
    expect(both).toContain("X --> Outer");
    expect(both).not.toContain('Inner["Inner"]');
  });
  it("rejects unsupported syntax instead of damaging source", () => {
    const source = examples["Flowchart · groups"] + "\nlinkStyle 0 stroke:red";
    expect(() => collapseFlowchart(source, ["PAS"])).toThrow("linkStyle");
    expect(collapseFlowchart(source, [])).toBe(source);
  });
  it("extracts metadata without changing ordinary Mermaid comments", () => {
    expect(groupMetadata('%% hello\n%% @collapse id=A label="Alpha"')).toEqual([
      { id: "A", label: "Alpha" },
    ]);
  });
});
