import type { Dispatch, SetStateAction } from "react";
import type { ExportOptions } from "../lib/export";
type Format = "svg" | "png" | "pdf";
type Props = {
  options: ExportOptions;
  onOptions: Dispatch<SetStateAction<ExportOptions>>;
  busy: boolean;
  onExport: (format: Format) => void;
  onClose: () => void;
};
export function ExportModal({
  options,
  onOptions,
  busy,
  onExport,
  onClose,
}: Props) {
  return (
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
              onOptions((o) => ({ ...o, scale: Number(e.target.value) }))
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
              onOptions((o) => ({ ...o, transparent: e.target.checked }))
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
              onOptions((o) => ({ ...o, background: e.target.value }))
            }
          />
        </label>
        <label>
          PDF Page Size
          <select
            value={options.page}
            onChange={(e) =>
              onOptions((o) => ({
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
              onOptions((o) => ({
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
            onChange={(e) => onOptions((o) => ({ ...o, fit: e.target.checked }))}
          />
          Fit PDF to page
        </label>
        <p>
          SVG preserves original labels and embeds Inter. PNG, clipboard, and
          PDF convert HTML labels to SVG text: rich formatting may differ. PDF
          uses standard fonts available in the PDF engine.
        </p>
        <div className="modal-actions">
          {(["svg", "png", "pdf"] as const).map((f) => (
            <button
              className="primary"
              disabled={busy}
              key={f}
              onClick={() => onExport(f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
          <button disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
        {busy && <p>Preparing export…</p>}
      </section>
    </div>
  );
}
