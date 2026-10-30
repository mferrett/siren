import { memo, useDeferredValue } from "react";
import { DocItem, sameDocItems } from "../lib/documents";
export type ContextMenuState = {
  kind: "recent" | "tab";
  id: string;
  x: number;
  y: number;
};
type Props = {
  items: DocItem[];
  active: string;
  search: string;
  onSearch: (value: string) => void;
  onOpen: (id: string) => void;
  onContextMenu: (menu: ContextMenuState) => void;
};
function SidebarView({
  items,
  active,
  search,
  onSearch,
  onOpen,
  onContextMenu,
}: Props) {
  const query = useDeferredValue(search).toLowerCase();
  return (
    <aside className="sidebar">
      <div className="sidebar-title">
        WORKSPACE <span>{items.length}</span>
      </div>
      <input
        aria-label="Search diagrams"
        className="search"
        placeholder="Search diagrams…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <div className="library-label">RECENT</div>
      <div className="document-list">
        {items
          .filter((d) => d.name.toLowerCase().includes(query))
          .map((d) => (
            <div
              key={d.id}
              className={`document-card ${d.id === active ? "selected" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu({
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
                onClick={() => onOpen(d.id)}
              >
                <strong>
                  {d.name}
                  {d.dirty ? " •" : ""}
                </strong>
              </button>
            </div>
          ))}
      </div>
    </aside>
  );
}
export const Sidebar = memo(
  SidebarView,
  (a, b) =>
    a.active === b.active &&
    a.search === b.search &&
    a.onSearch === b.onSearch &&
    a.onOpen === b.onOpen &&
    a.onContextMenu === b.onContextMenu &&
    sameDocItems(a.items, b.items),
);
