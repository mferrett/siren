import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Editor, retainEditorModels } from "./components/Editor";
import { Preview } from "./components/Preview";
import {
  Archive,
  Diagram,
  createDiagram,
  examples,
  importedDiagrams,
  initialArchive,
  parseArchive,
} from "./lib/documents";
import {
  desktop,
  loadArchive,
  persist,
  readFile,
  saveBytes,
  writeFile,
} from "./lib/native";
import { collapseFlowchart, groupMetadata } from "./lib/groups";
import { renderDiagram } from "./lib/render";
import {
  copyDiagram,
  defaultExport,
  exportDiagram,
  ExportOptions,
} from "./lib/export";
type Dialog = {
  title: string;
  message?: string;
  choices: string[];
  input?: string;
  resolve: (v: string | null) => void;
};
type Rendered = { svg: string; key: string };
type ContextMenuState = {
  kind: "recent" | "tab";
  id: string;
  x: number;
  y: number;
};
export default function App() {
  const [archive, commitArchive] = useState<Archive>(initialArchive);
  const state = useRef(archive);
  function setArchive(value: Archive | ((a: Archive) => Archive)) {
    const next = typeof value === "function" ? value(state.current) : value;
    state.current = next;
    commitArchive(next);
  }
  const [ready, setReady] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [renders, setRenders] = useState<Record<string, Rendered>>({}),
    [rendering, setRendering] = useState(false);
  const [search, setSearch] = useState(""),
    [sidebar, setSidebar] = useState(true),
    [mode, setMode] = useState<"split" | "editor" | "preview">("split"),
    [fullscreen, setFullscreen] = useState(false),
    [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null),
    [dragTabId, setDragTabId] = useState<string | null>(null),
    [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [input, setInput] = useState(""),
    [templateModal, setTemplateModal] = useState(false),
    [templateName, setTemplateName] = useState("Untitled"),
    [selectedTemplate, setSelectedTemplate] = useState(
      () => Object.keys(examples)[0],
    ),
    [settings, setSettings] = useState(false),
    [exporting, setExporting] = useState(false),
    [options, setOptions] = useState(defaultExport),
    [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    layout = useRef<HTMLDivElement>(null),
    openQueue = useRef(Promise.resolve()),
    dialogQueue = useRef(Promise.resolve()),
    renderGeneration = useRef(0);
  const ratio = archive.splitRatio ?? 48;
  function setRatio(value: number | ((r: number) => number)) {
    setArchive((a) => {
      const current = a.splitRatio ?? 48;
      const next = typeof value === "function" ? value(current) : value;
      return { ...a, splitRatio: Math.max(20, Math.min(80, next)) };
    });
  }
  function getOpenIds(a: Archive): string[] {
    return a.openTabs ?? (a.active ? [a.active] : []);
  }
  function openDoc(id: string) {
    setArchive((a) => {
      const tabs = getOpenIds(a);
      return {
        ...a,
        active: id,
        openTabs: tabs.includes(id) ? tabs : [...tabs, id],
      };
    });
  }
  function closeTab(id: string) {
    setArchive((a) => {
      const tabs = getOpenIds(a);
      const idx = tabs.indexOf(id);
      if (idx === -1) return a;
      const nextTabs = tabs.filter((t) => t !== id);
      const nextActive =
        a.active === id
          ? (nextTabs[Math.min(idx, nextTabs.length - 1)] ?? "")
          : a.active;
      return {
        ...a,
        openTabs: nextTabs,
        active: nextActive,
      };
    });
  }
  function reorderTabs(fromId: string, toId: string) {
    if (fromId === toId) return;
    setArchive((a) => {
      const tabs = [...getOpenIds(a)];
      const fromIdx = tabs.indexOf(fromId);
      const toIdx = tabs.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return a;
      tabs.splice(fromIdx, 1);
      tabs.splice(toIdx, 0, fromId);
      return { ...a, openTabs: tabs };
    });
  }
  const openIds = getOpenIds(archive);
  const openDocs = openIds
    .map((id) => archive.documents.find((d) => d.id === id))
    .filter((d): d is Diagram => !!d);
  const doc = openDocs.find((d) => d.id === archive.active);
  const snapshot = doc ? renders[doc.id] : undefined;
  const renderKey = doc
    ? JSON.stringify([doc.code, doc.collapsed, archive.mermaidTheme])
    : "";
  const stale = !!snapshot && snapshot.key !== renderKey;
  function ask(
    title: string,
    choices: string[],
    message?: string,
    initial?: string,
  ): Promise<string | null> {
    const task = dialogQueue.current.then(
      () =>
        new Promise<string | null>((resolve) => {
          setInput(initial ?? "");
          setDialog({ title, choices, message, input: initial, resolve });
        }),
    );
    dialogQueue.current = task.then(() => {});
    return task;
  }
  function resolveDialog(value: string | null) {
    dialog?.resolve(value);
    setDialog(null);
  }
  function updateDoc(id: string, patch: Partial<Diagram>) {
    setArchive((a) => ({
      ...a,
      documents: a.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  }
  async function renameDocument(d: Diagram) {
    const name = await ask("Rename", ["Rename"], undefined, d.name);
    if (name) updateDoc(d.id, { name, modified: Date.now() });
  }
  function changeCode(code: string) {
    if (doc) updateDoc(doc.id, { code, modified: Date.now() });
  }
  async function saveDocument(d: Diagram, as = false): Promise<boolean> {
    try {
      if (as || (desktop && !d.path)) {
        const path = await saveBytes(
          `${d.name.replace(/\.(mmd|mermaid)$/i, "")}.mmd`,
          new TextEncoder().encode(d.code),
          "mmd",
        );
        if (!path) return false;
        updateDoc(d.id, {
          ...(desktop ? { path, externalText: d.code } : {}),
          savedCode: d.code,
        });
      } else {
        if (d.path)
          await writeFile(d.path, d.code, d.externalText ?? d.savedCode);
        updateDoc(d.id, {
          savedCode: d.code,
          ...(d.path ? { externalText: d.code } : {}),
        });
      }
      setNotice("Diagram saved");
      return true;
    } catch (e) {
      setNotice(String(e));
      return false;
    }
  }
  async function protectCurrent() {
    const d = state.current.documents.find(
      (x) => x.id === state.current.active,
    );
    if (!d || d.code === d.savedCode) return true;
    const choice = await ask(
      "Unsaved Changes",
      ["Save", "Discard", "Cancel"],
      `“${d.name}” has unsaved changes. Your draft is recoverable in the workspace.`,
    );
    if (choice === "Save") return saveDocument(d);
    if (choice === "Discard") {
      updateDoc(d.id, { code: d.savedCode });
      return true;
    }
    return false;
  }
  async function addImported(path: string, text: string) {
    const docs = importedDiagrams(path, text);
    let d = docs[0];
    if (docs.length > 1) {
      const choice = await ask(
        "Choose Mermaid Block",
        docs.map((_, i) => `Block ${i + 1}`),
        "The selected block will be imported as a copy in the workspace. The original Markdown file will not be modified.",
      );
      if (!choice) return;
      d = docs[Number(choice.split(" ")[1]) - 1];
    }
    setArchive((a) => {
      const tabs = getOpenIds(a);
      return {
        ...a,
        documents: [d, ...a.documents],
        openTabs: [...tabs.filter((t) => t !== d.id), d.id],
        active: d.id,
      };
    });
  }
  function enqueuePaths(paths: string[]) {
    openQueue.current = openQueue.current
      .then(async () => {
        if (!paths.length || !(await protectCurrent())) return;
        for (const path of paths) {
          try {
            const f = await readFile(path);
            await addImported(path, f.text);
          } catch (e) {
            setNotice(String(e));
          }
        }
      })
      .catch((e) => setNotice(String(e)));
  }
  async function openFiles() {
    if (desktop) enqueuePaths(await invoke<string[]>("choose_files"));
    else fileInput.current?.click();
  }
  async function newDocument(code?: string) {
    const name = await ask(
      "New Diagram",
      ["Create"],
      "Choose a name for the diagram.",
      "Untitled",
    );
    if (!name) return;
    const d = createDiagram(name, code);
    setArchive((a) => {
      const tabs = getOpenIds(a);
      return {
        ...a,
        documents: [d, ...a.documents],
        openTabs: [...tabs.filter((t) => t !== d.id), d.id],
        active: d.id,
      };
    });
  }
  function openNewFromTemplate() {
    setTemplateName("Untitled");
    setSelectedTemplate(Object.keys(examples)[0]);
    setTemplateModal(true);
  }
  function createFromTemplate() {
    const name = templateName.trim();
    if (!name) return;
    const d = createDiagram(name, examples[selectedTemplate]);
    setArchive((a) => {
      const tabs = getOpenIds(a);
      return {
        ...a,
        documents: [d, ...a.documents],
        openTabs: [...tabs.filter((t) => t !== d.id), d.id],
        active: d.id,
      };
    });
    setTemplateModal(false);
  }
  async function removeDocument(d: Diagram) {
    const choice = await ask(
      "Remove from Workspace",
      ["Remove", "Cancel"],
      `Remove “${d.name}” from Siren’s workspace?${d.path ? " The file on disk will not be deleted." : ""}`,
    );
    if (choice !== "Remove") return;
    setArchive((a) => {
      const documents = a.documents.filter((x) => x.id !== d.id);
      const tabs = getOpenIds(a).filter((t) => t !== d.id);
      return {
        ...a,
        documents,
        openTabs: tabs,
        active: a.active === d.id ? (tabs[0] ?? "") : a.active,
      };
    });
  }
  async function revealInFinder(d: Diagram) {
    if (!d.path) return;
    try {
      await invoke("reveal_in_folder", { path: d.path });
    } catch (e) {
      setNotice(String(e));
    }
  }
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let a = await loadArchive();
        const recovery = localStorage.getItem("mermaid-recovery");
        if (recovery) {
          a = parseArchive(recovery);
          setNotice(
            "Draft recovered after an unexpected interruption. Review and save your changes.",
          );
        }
        if (live && a) setArchive(a);
        if (live) setReady(true);
      } catch (e) {
        setNotice(
          `Workspace archive not loaded: ${e}. Restart after checking your data; no archive will be overwritten.`,
        );
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const data = JSON.stringify(archive);
    try {
      localStorage.setItem("mermaid-recovery", data);
    } catch (e) {
      setNotice(`Local recovery unavailable: ${e}`);
    }
    const timer = setTimeout(() => {
      persist(archive)
        .then(() => {
          if (localStorage.getItem("mermaid-recovery") === data)
            localStorage.removeItem("mermaid-recovery");
        })
        .catch((e) => setNotice(`Workspace not saved: ${e}`));
    }, 200);
    return () => clearTimeout(timer);
  }, [archive, ready]);
  useEffect(() => {
    if (!ready || !archive.autosave) return;
    const timer = setTimeout(() => {
      setArchive((a) => {
        if (!a.documents.some((d) => !d.path && d.code !== d.savedCode))
          return a;
        return {
          ...a,
          documents: a.documents.map((d) =>
            d.path ? d : { ...d, savedCode: d.code },
          ),
        };
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [archive.documents, archive.autosave, ready]);
  useEffect(() => {
    const generation = ++renderGeneration.current;
    if (!doc) {
      setError("");
      return;
    }
    setRendering(true);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const code = collapseFlowchart(doc.code, doc.collapsed);
        const svg = await renderDiagram(code, archive.mermaidTheme);
        if (generation === renderGeneration.current) {
          setRenders((r) => ({ ...r, [doc.id]: { svg, key: renderKey } }));
          setError("");
        }
      } catch (e) {
        if (generation === renderGeneration.current)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (generation === renderGeneration.current) setRendering(false);
      }
    }, archive.debounce);
    return () => {
      clearTimeout(timer);
      renderGeneration.current++;
    };
  }, [renderKey, doc?.id, archive.debounce]);
  const menuAction = useRef<(action: string) => void>(() => {});
  menuAction.current = (action: string) => {
    if (dialog) return;
    switch (action) {
      case "menu_new":
        void newDocument();
        break;
      case "menu_new_template":
        openNewFromTemplate();
        break;
      case "menu_open":
        void openFiles();
        break;
      case "menu_save":
        if (doc && ready) void saveDocument(doc);
        break;
      case "menu_save_as":
        if (doc) void saveDocument(doc, true);
        break;
      case "menu_export":
        if (snapshot && !busy) setExporting(true);
        break;
      case "menu_settings":
        setSettings(true);
        break;
      case "close_tab":
        if (doc) closeTab(doc.id);
        break;
    }
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2800);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!ready || !desktop) return;
    let disposed = false;
    const unsub: (() => void)[] = [];
    function keep(f: () => void) {
      if (disposed) f();
      else unsub.push(f);
    }
    const drain = async () =>
      enqueuePaths(await invoke<string[]>("pending_files"));
    listen("files-pending", () => {
      void drain();
    })
      .then(keep)
      .then(drain)
      .catch((e) => setNotice(String(e)));
    listen<string>("file-error", (e) => setNotice(e.payload)).then(keep);
    getCurrentWindow()
      .onDragDropEvent((e) => {
        setDragging(e.payload.type === "enter" || e.payload.type === "over");
      })
      .then(keep);
    const close = async () => {
      const dirty = state.current.documents.filter(
        (d) => d.code !== d.savedCode,
      );
      if (dirty.length) {
        const choice = await ask(
          "Quit Application?",
          ["Save All & Quit", "Keep Drafts & Quit", "Cancel"],
          `${dirty.length} diagrams have unsaved changes. Drafts keep your changes without overwriting files on disk.`,
        );
        if (!choice || choice === "Cancel") return;
        if (choice === "Save All & Quit") {
          for (const d of dirty) if (!(await saveDocument(d))) return;
        }
      }
      try {
        await persist(state.current);
        localStorage.removeItem("mermaid-recovery");
        await invoke("exit_app");
      } catch (e) {
        setNotice(`Quit cancelled: ${e}`);
      }
    };
    getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void close();
      })
      .then(keep);
    listen("exit-requested", () => {
      void close();
    }).then(keep);
    listen<string>("menu-action", (e) => {
      menuAction.current(e.payload);
    }).then(keep);
    return () => {
      disposed = true;
      unsub.forEach((f) => f());
    };
  }, [ready]);
  function toggleFullscreen(next?: boolean) {
    const target = next ?? !fullscreen;
    setFullscreen(target);
    if (target) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }
  useEffect(() => {
    const preventContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", preventContextMenu);
    return () => window.removeEventListener("contextmenu", preventContextMenu);
  }, []);
  useEffect(() => {
    document.documentElement.style.colorScheme = archive.theme;
    if (desktop) {
      invoke("set_window_theme", { theme: archive.theme }).catch(() => {});
    }
  }, [archive.theme]);
  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenu]);
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape" && contextMenu) {
        e.preventDefault();
        setContextMenu(null);
        return;
      }
      if (e.key === "Escape" && templateModal) {
        e.preventDefault();
        setTemplateModal(false);
        return;
      }
      if (e.key === "Escape" && fullscreen) {
        e.preventDefault();
        toggleFullscreen(false);
        return;
      }
      if (
        dialog ||
        templateModal ||
        settings ||
        exporting ||
        !(e.metaKey || e.ctrlKey)
      )
        return;
      if (e.key === ",") {
        e.preventDefault();
        e.stopPropagation();
        setSettings(true);
      }
      if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        e.stopPropagation();
        if (snapshot && !busy) setExporting(true);
      }
      if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        e.stopPropagation();
        if (doc) closeTab(doc.id);
      }
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        if (doc) void saveDocument(doc, e.shiftKey);
      }
      if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        e.stopPropagation();
        void openFiles();
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) openNewFromTemplate();
        else void newDocument();
      }
    }
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  useEffect(() => {
    if (!desktop) return;
    const focus = async () => {
      const d = state.current.documents.find(
        (d) => d.id === state.current.active,
      );
      if (!d?.path) return;
      try {
        const f = await readFile(d.path);
        if (f.text !== d.externalText)
          setNotice(
            "The file on disk has changed. Use “Reload File” or “Save As” to keep your version.",
          );
      } catch (e) {
        setNotice(String(e));
      }
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  async function reloadExternal() {
    if (!doc?.path || !(await protectCurrent())) return;
    try {
      const f = await readFile(doc.path);
      updateDoc(doc.id, {
        code: f.text,
        savedCode: f.text,
        externalText: f.text,
        modified: Date.now(),
      });
    } catch (e) {
      setNotice(String(e));
    }
  }
  async function output(format: "svg" | "png" | "pdf" | "clipboard") {
    if (!snapshot || !doc) return;
    if (
      stale &&
      (await ask(
        "Preview is Out of Date",
        ["Use Latest Valid Preview", "Cancel"],
        "The current source code does not match the displayed diagram.",
      )) !== "Use Latest Valid Preview"
    )
      return;
    setBusy(true);
    try {
      if (format === "clipboard") {
        await copyDiagram(snapshot.svg, options);
        setNotice("Image copied to clipboard");
      } else if (await exportDiagram(snapshot.svg, doc.name, format, options))
        setNotice(`${format.toUpperCase()} export completed`);
    } catch (e) {
      setNotice(`Export failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    retainEditorModels(archive.documents.map((d) => d.id));
  }, [archive.documents]);
  const dirty = doc && doc.code !== doc.savedCode;
  const groups = doc ? groupMetadata(doc.code) : [];
  const revealLabel =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac")
      ? "Reveal in Finder"
      : "Reveal in File Explorer";
  return (
    <div className={`app ${archive.theme}`}>
      <div className="workspace">
        {sidebar && (
          <aside className="sidebar">
            <div className="sidebar-title">
              WORKSPACE <span>{archive.documents.length}</span>
            </div>
            <input
              aria-label="Search diagrams"
              className="search"
              placeholder="Search diagrams…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="library-label">RECENT</div>
            <div className="document-list">
              {archive.documents
                .filter((d) =>
                  d.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((d) => (
                  <div
                    key={d.id}
                    className={`document-card ${d.id === archive.active ? "selected" : ""}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        kind: "recent",
                        id: d.id,
                        x: Math.min(e.clientX, window.innerWidth - 200),
                        y: Math.min(e.clientY, window.innerHeight - 160),
                      });
                    }}
                  >
                    <button
                      className="document-open"
                      title={d.name}
                      onClick={() => openDoc(d.id)}
                    >
                      <strong>
                        {d.name}
                        {d.code !== d.savedCode ? " •" : ""}
                      </strong>
                    </button>
                  </div>
                ))}
            </div>
          </aside>
        )}
        {contextMenu &&
          (() => {
            const target = archive.documents.find(
              (d) => d.id === contextMenu.id,
            );
            if (!target) return null;
            if (contextMenu.kind === "tab") {
              return (
                <div
                  className="context-menu"
                  role="menu"
                  style={{ left: contextMenu.x, top: contextMenu.y }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setContextMenu(null);
                      void renameDocument(target);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    role="menuitem"
                    disabled={!target.path || !desktop}
                    onClick={() => {
                      setContextMenu(null);
                      void revealInFinder(target);
                    }}
                  >
                    {revealLabel}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setContextMenu(null);
                      closeTab(target.id);
                    }}
                  >
                    Close Tab
                  </button>
                </div>
              );
            }
            return (
              <div
                className="context-menu"
                role="menu"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setContextMenu(null);
                    void renameDocument(target);
                  }}
                >
                  Rename
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setContextMenu(null);
                    const copy = {
                      ...createDiagram(`${target.name} · copy`, target.code),
                      collapsed: [...target.collapsed],
                    };
                    setArchive((a) => {
                      const tabs = getOpenIds(a);
                      return {
                        ...a,
                        documents: [copy, ...a.documents],
                        openTabs: [
                          ...tabs.filter((t) => t !== copy.id),
                          copy.id,
                        ],
                        active: copy.id,
                      };
                    });
                  }}
                >
                  Duplicate
                </button>
                <button
                  role="menuitem"
                  disabled={!target.path || !desktop}
                  onClick={() => {
                    setContextMenu(null);
                    void revealInFinder(target);
                  }}
                >
                  {revealLabel}
                </button>
                <div className="context-divider" />
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setContextMenu(null);
                    void removeDocument(target);
                  }}
                >
                  Remove from Workspace
                </button>
              </div>
            );
          })()}
        <main className="main">
          <div className="document-toolbar">
            <button
              className="sidebar-toggle"
              title="Toggle Sidebar"
              aria-label="Toggle Sidebar"
              onClick={() => setSidebar(!sidebar)}
            >
              ☰
            </button>
            <div className="document-title">
              <strong>{doc?.name ?? "No Diagram Open"}</strong>
              <small>
                {doc
                  ? dirty
                    ? "Unsaved changes · draft recoverable"
                    : "Saved"
                  : "Create or open a diagram to begin"}
              </small>
            </div>
            <div className="view-switch" role="group" aria-label="View mode">
              {(["editor", "split", "preview"] as const).map((m) => (
                <button
                  key={m}
                  className={mode === m ? "active" : ""}
                  onClick={() => setMode(m)}
                >
                  {m === "editor"
                    ? "Code"
                    : m === "split"
                      ? "Split"
                      : "Preview"}
                </button>
              ))}
            </div>
          </div>
          {openDocs.length > 0 && (
            <div
              className="document-tabs"
              role="tablist"
              aria-label="Open diagrams"
            >
              {openDocs.map((d) => (
                <div
                  key={d.id}
                  draggable
                  className={`tab-item ${d.id === archive.active ? "active" : ""} ${dragTabId === d.id ? "dragging" : ""}`}
                  onDragStart={(e) => {
                    setDragTabId(d.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", d.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragTabId && dragTabId !== d.id) {
                      reorderTabs(dragTabId, d.id);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from =
                      dragTabId || e.dataTransfer.getData("text/plain");
                    if (from && from !== d.id) reorderTabs(from, d.id);
                    setDragTabId(null);
                  }}
                  onDragEnd={() => setDragTabId(null)}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      closeTab(d.id);
                    }
                  }}
                  onDoubleClick={() => void renameDocument(d)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({
                      kind: "tab",
                      id: d.id,
                      x: Math.min(e.clientX, window.innerWidth - 160),
                      y: Math.min(e.clientY, window.innerHeight - 100),
                    });
                  }}
                >
                  <button
                    role="tab"
                    className="tab-open"
                    aria-selected={d.id === archive.active}
                    title={d.name}
                    onClick={() =>
                      setArchive((a) => ({ ...a, active: d.id }))
                    }
                  >
                    <span className="tab-label">{d.name}</span>
                    {d.code !== d.savedCode && (
                      <span className="tab-dirty">•</span>
                    )}
                  </button>
                  <button
                    className="tab-close"
                    title="Close Tab (⌘W)"
                    aria-label={`Close ${d.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(d.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {!ready && <div className="notice">Loading workspace…</div>}
          {doc ? (
            <>
              <div
                className="panels"
                ref={layout}
                style={{
                  gridTemplateColumns:
                    mode === "split"
                      ? `round(${ratio}%, 1px) 6px minmax(0,1fr)`
                      : "minmax(0,1fr)",
                }}
              >
                {mode !== "preview" && (
                  <section className="editor-panel">
                    <Editor
                      id={doc.id}
                      value={doc.code}
                      dark={archive.theme === "dark"}
                      error={error}
                      onChange={changeCode}
                    />
                    <div className="editor-footer">
                      {doc.code.split("\n").length} lines{" "}
                      <span>UTF-8 · Mermaid</span>
                    </div>
                  </section>
                )}
                {mode === "split" && (
                  <div
                    className="splitter"
                    role="separator"
                    aria-label="Resize panels"
                    aria-valuenow={ratio}
                    aria-valuemin={20}
                    aria-valuemax={80}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft")
                        setRatio((r) => Math.max(20, r - 2));
                      if (e.key === "ArrowRight")
                        setRatio((r) => Math.min(80, r + 2));
                    }}
                    onPointerDown={(e) =>
                      e.currentTarget.setPointerCapture(e.pointerId)
                    }
                    onPointerMove={(e) => {
                      if (
                        e.currentTarget.hasPointerCapture(e.pointerId) &&
                        layout.current
                      ) {
                        const b = layout.current.getBoundingClientRect();
                        setRatio(
                          Math.max(
                            20,
                            Math.min(
                              80,
                              ((e.clientX - b.left) / b.width) * 100,
                            ),
                          ),
                        );
                      }
                    }}
                    onPointerUp={(e) =>
                      e.currentTarget.releasePointerCapture(e.pointerId)
                    }
                  />
                )}
                {(mode !== "editor" || fullscreen) && (
                  <section
                    className={`preview-panel ${fullscreen ? "fullscreen" : ""}`}
                  >
                    <div className="panel-heading">
                      <span className="preview-status">
                        {rendering
                          ? "Updating…"
                          : stale
                            ? "Out of date"
                            : ""}
                      </span>
                      <div className="panel-actions">
                        <button
                          disabled={!snapshot || busy}
                          onClick={() => void output("clipboard")}
                        >
                          Copy Image
                        </button>
                        <button
                          onClick={() => toggleFullscreen()}
                          title={
                            fullscreen
                              ? "Exit Full Screen (Esc)"
                              : "Present in Full Screen"
                          }
                        >
                          {fullscreen ? "Exit Full Screen" : "Full Screen ⛶"}
                        </button>
                      </div>
                    </div>
                    {groups.length > 0 && (
                      <div className="group-controls">
                        <span>Groups</span>
                        {groups.map((g) => (
                          <button
                            key={g.id}
                            className={
                              doc.collapsed.includes(g.id) ? "collapsed" : ""
                            }
                            onClick={() =>
                              updateDoc(doc.id, {
                                collapsed: doc.collapsed.includes(g.id)
                                  ? doc.collapsed.filter((id) => id !== g.id)
                                  : [...doc.collapsed, g.id],
                              })
                            }
                          >
                            {doc.collapsed.includes(g.id) ? "＋" : "−"}{" "}
                            {g.label}
                          </button>
                        ))}
                        <button
                          onClick={() =>
                            updateDoc(doc.id, {
                              collapsed: groups.map((g) => g.id),
                            })
                          }
                        >
                          Collapse All
                        </button>
                        <button
                          onClick={() => updateDoc(doc.id, { collapsed: [] })}
                        >
                          Expand All
                        </button>
                      </div>
                    )}
                    <Preview
                      docId={doc.id}
                      svg={snapshot?.svg ?? ""}
                      fullscreen={fullscreen}
                      onToggleFullscreen={() => toggleFullscreen()}
                    />
                    {stale && (
                      <div className="stale">
                        Showing last valid preview · does not match current
                        edits
                      </div>
                    )}
                  </section>
                )}
              </div>
              {error && (
                <div className="error" role="alert">
                  <strong>Syntax Error</strong>
                  <pre>{error}</pre>
                </div>
              )}
              {doc.path && (
                <div className="external-bar">
                  <span title={doc.path}>{doc.path}</span>
                  <button onClick={() => void reloadExternal()}>
                    Reload File
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="welcome">
              <h1>Every idea deserves a diagram.</h1>
              <p>Start from a template or open a Mermaid file.</p>
              <div className="welcome-actions">
                <button className="primary" onClick={() => void newDocument()}>
                  New Diagram
                </button>
                <button onClick={openNewFromTemplate}>
                  New from Template…
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
      <input
        hidden
        type="file"
        multiple
        ref={fileInput}
        accept=".mmd,.mermaid,.md"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!(await protectCurrent())) return;
          for (const f of files)
            try {
              await addImported(f.name, await f.text());
            } catch (err) {
              setNotice(String(err));
            }
        }}
      />
      {dragging && (
        <div className="drop-overlay">
          <div>
            Drop your diagrams here
            <small>
              .mmd · .mermaid · .md — each file will be added to your workspace
            </small>
          </div>
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop dialog-priority">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.title}
          >
            <h2>{dialog.title}</h2>
            {dialog.message && <p>{dialog.message}</p>}
            {dialog.input !== undefined && (
              <input
                autoFocus
                aria-label="Diagram name"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && input.trim())
                    resolveDialog(input.trim());
                }}
              />
            )}
            <div className="modal-actions">
              {dialog.choices.map((c, i) => (
                <button
                  className={i === 0 ? "primary" : ""}
                  key={c}
                  disabled={dialog.input !== undefined && !input.trim()}
                  onClick={() =>
                    resolveDialog(dialog.input !== undefined ? input.trim() : c)
                  }
                >
                  {c}
                </button>
              ))}
              {!dialog.choices.includes("Cancel") && (
                <button onClick={() => resolveDialog(null)}>Cancel</button>
              )}
            </div>
          </section>
        </div>
      )}
      {templateModal && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="New from Template"
          >
            <h2>New from Template</h2>
            <label>
              Diagram Name
              <input
                autoFocus
                aria-label="Diagram Name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && templateName.trim())
                    createFromTemplate();
                }}
              />
            </label>
            <label>
              Template
              <select
                aria-label="Template"
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              >
                {Object.keys(examples).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button
                className="primary"
                disabled={!templateName.trim()}
                onClick={createFromTemplate}
              >
                Create
              </button>
              <button onClick={() => setTemplateModal(false)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {settings && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
          >
            <h2>Settings</h2>
            <label>
              Appearance
              <select
                aria-label="Appearance"
                value={archive.theme}
                onChange={(e) =>
                  setArchive((a) => ({
                    ...a,
                    theme: e.target.value as "light" | "dark",
                  }))
                }
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              Default Mermaid Theme
              <select
                aria-label="Default Mermaid Theme"
                value={archive.mermaidTheme}
                onChange={(e) =>
                  setArchive((a) => ({ ...a, mermaidTheme: e.target.value }))
                }
              >
                {["default", "neutral", "dark", "forest", "base"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <p>
              Diagram frontmatter and directives take precedence. The app
              appearance is independent of the diagram theme.
            </p>
            <label>
              Preview Debounce (ms)
              <input
                type="number"
                min="100"
                max="3000"
                step="50"
                value={archive.debounce}
                onChange={(e) =>
                  setArchive((a) => ({
                    ...a,
                    debounce: Math.max(
                      100,
                      Math.min(3000, Number(e.target.value)),
                    ),
                  }))
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={archive.autosave}
                onChange={(e) =>
                  setArchive((a) => ({ ...a, autosave: e.target.checked }))
                }
              />
              Automatically save workspace diagrams
            </label>
            <p>
              Drafts are always preserved. Files on disk require an explicit
              Save. Inter font is bundled; missing fonts fall back to local
              sans-serif.
            </p>
            <button className="primary" onClick={() => setSettings(false)}>
              Done
            </button>
          </section>
        </div>
      )}
      {exporting && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Export Diagram"
          >
            <h2>Export Diagram</h2>
            <label>
              PNG Scale
              <select
                value={options.scale}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, scale: Number(e.target.value) }))
                }
              >
                {[1, 2, 3, 4].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={options.transparent}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, transparent: e.target.checked }))
                }
              />
              Transparent background (PNG / PDF)
            </label>
            <label>
              Background
              <input
                type="color"
                value={options.background}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, background: e.target.value }))
                }
              />
            </label>
            <label>
              PDF Page Size
              <select
                value={options.page}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    page: e.target.value as ExportOptions["page"],
                  }))
                }
              >
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </select>
            </label>
            <label>
              Orientation
              <select
                value={options.orientation}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    orientation: e.target.value as ExportOptions["orientation"],
                  }))
                }
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={options.fit}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, fit: e.target.checked }))
                }
              />
              Fit PDF to page
            </label>
            <p>
              SVG preserves original labels and embeds Inter. PNG, clipboard,
              and PDF convert HTML labels to SVG text: rich formatting may
              differ. PDF uses standard fonts available in the PDF engine.
            </p>
            <div className="modal-actions">
              {(["svg", "png", "pdf"] as const).map((f) => (
                <button
                  className="primary"
                  disabled={busy}
                  key={f}
                  onClick={() => void output(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
              <button disabled={busy} onClick={() => setExporting(false)}>
                Close
              </button>
            </div>
            {busy && <p>Preparing export…</p>}
          </section>
        </div>
      )}
    </div>
  );
}
