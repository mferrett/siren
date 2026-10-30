import type { Archive } from "../lib/documents";
type Props = Pick<
  Archive,
  "theme" | "mermaidTheme" | "debounce" | "autosave"
> & {
  onChange: (patch: Partial<Archive>) => void;
  onClose: () => void;
};
export function SettingsModal({
  theme,
  mermaidTheme,
  debounce,
  autosave,
  onChange,
  onClose,
}: Props) {
  return (
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
            value={theme}
            onChange={(e) =>
              onChange({ theme: e.target.value as "light" | "dark" })
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
            value={mermaidTheme}
            onChange={(e) => onChange({ mermaidTheme: e.target.value })}
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
            value={debounce}
            onChange={(e) =>
              onChange({
                debounce: Math.max(100, Math.min(3000, Number(e.target.value))),
              })
            }
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={autosave}
            onChange={(e) => onChange({ autosave: e.target.checked })}
          />
          Automatically save workspace diagrams
        </label>
        <p>
          Drafts are always preserved. Files on disk require an explicit Save.
          Inter font is bundled; missing fonts fall back to local sans-serif.
        </p>
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </section>
    </div>
  );
}
