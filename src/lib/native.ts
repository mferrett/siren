import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Archive } from "./documents";
import { parseArchive } from "./documents";
export const desktop = isTauri();
let writeQueue = Promise.resolve();
export async function loadArchive(): Promise<Archive | undefined> {
  const raw = desktop
    ? await invoke<string | null>("load_archive")
    : localStorage.getItem("mermaid-archive");
  return raw ? parseArchive(raw) : undefined;
}
export function persist(a: Archive | string): Promise<void> {
  const data = typeof a === "string" ? a : JSON.stringify(a);
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      if (desktop) await invoke("save_archive", { data });
      else localStorage.setItem("mermaid-archive", data);
    });
  return writeQueue;
}
export async function saveBytes(
  name: string,
  bytes: Uint8Array,
  extension: string,
): Promise<string | null> {
  if (desktop)
    return invoke("save_as", { name, bytes: Array.from(bytes), extension });
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
export const readFile = (path: string) =>
  invoke<{ path: string; text: string }>("read_file", { path });
export const writeFile = (path: string, text: string, expected: string) =>
  invoke<void>("write_file", { path, text, expected });
