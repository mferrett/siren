import { memo } from "react";
type Group = { id: string; label: string };
type Props = {
  groups: Group[];
  collapsed: string[];
  onChange: (collapsed: string[]) => void;
};
function GroupControlsView({ groups, collapsed, onChange }: Props) {
  return (
    <div className="group-controls">
      <span>Groups</span>
      {groups.map((g) => {
        const isCollapsed = collapsed.includes(g.id);
        return (
          <button
            key={g.id}
            className={isCollapsed ? "collapsed" : ""}
            onClick={() =>
              onChange(
                isCollapsed
                  ? collapsed.filter((id) => id !== g.id)
                  : [...collapsed, g.id],
              )
            }
          >
            {isCollapsed ? "＋" : "−"} {g.label}
          </button>
        );
      })}
      <button onClick={() => onChange(groups.map((g) => g.id))}>
        Collapse All
      </button>
      <button onClick={() => onChange([])}>Expand All</button>
    </div>
  );
}
export const GroupControls = memo(
  GroupControlsView,
  (a, b) =>
    a.collapsed === b.collapsed &&
    a.onChange === b.onChange &&
    a.groups.length === b.groups.length &&
    a.groups.every(
      (g, i) => g.id === b.groups[i].id && g.label === b.groups[i].label,
    ),
);
