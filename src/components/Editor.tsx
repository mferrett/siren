import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
monaco.languages.register({ id: "mermaid" });
monaco.languages.setMonarchTokensProvider("mermaid", {
  tokenizer: {
    root: [
      [/%%.*$/, "comment"],
      [/"[^"]*"/, "string"],
      [
        /\b(flowchart|graph|subgraph|end|sequenceDiagram|classDiagram|stateDiagram-v2|erDiagram|gantt|pie|mindmap|participant|actor|classDef|style|direction|title|config)\b/,
        "keyword",
      ],
      [/-->|---|==>|-.->|->>|-->>/, "operator"],
      [/[\[\]{}()]/, "delimiter.bracket"],
      [/\b\d+\b/, "number"],
    ],
  },
});
const models = new Map<string, monaco.editor.ITextModel>();
export function retainEditorModels(ids: string[]) {
  for (const [id, model] of models)
    if (!ids.includes(id)) {
      model.dispose();
      models.delete(id);
    }
}
export function Editor({
  id,
  value,
  dark,
  error,
  onChange,
}: {
  id: string;
  value: string;
  dark: boolean;
  error: string;
  onChange: (s: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const e = monaco.editor.create(host.current!, {
      editContext: false,
      autoIndent: "none",
      language: "mermaid",
      theme: dark ? "vs-dark" : "vs",
      automaticLayout: true,
      contextmenu: false,
      minimap: { enabled: false },
      fontSize: 12,
      lineHeight: 18,
      padding: { top: 10 },
      scrollBeyondLastLine: false,
      tabSize: 4,
      wordWrap: "on",
    });
    editor.current = e;
    const sub = e.onDidChangeModelContent(() => change.current(e.getValue()));
    return () => {
      sub.dispose();
      e.dispose();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    const e = editor.current;
    if (!e) return;
    let model = models.get(id);
    if (!model) {
      model = monaco.editor.createModel(value, "mermaid");
      models.set(id, model);
    } else if (model.getValue() !== value) {
      model.setValue(value);
    }
    if (e.getModel() !== model) {
      e.setModel(model);
    }
    const pos = e.getPosition() ?? { lineNumber: 1, column: 1 };
    e.setSelection(
      new monaco.Selection(
        pos.lineNumber,
        pos.column,
        pos.lineNumber,
        pos.column,
      ),
    );
  }, [id]);
  useEffect(() => {
    const model = editor.current?.getModel();
    if (model && model.getValue() !== value) {
      model.setValue(value);
    }
  }, [value, id]);
  useEffect(() => {
    monaco.editor.setTheme(dark ? "vs-dark" : "vs");
  }, [dark]);
  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model) return;
    const line = Math.min(
      model.getLineCount(),
      Number(error.match(/line\s+(\d+)/i)?.[1] || 1),
    );
    monaco.editor.setModelMarkers(
      model,
      "mermaid",
      error
        ? [
            {
              severity: monaco.MarkerSeverity.Error,
              message: error,
              startLineNumber: line,
              endLineNumber: line,
              startColumn: 1,
              endColumn: model.getLineMaxColumn(line),
            },
          ]
        : [],
    );
  }, [error, id]);
  return <div className="monaco-host" ref={host} />;
}
