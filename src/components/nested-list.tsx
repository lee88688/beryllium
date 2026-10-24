import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";

export type NestedItem = {
  id: string;
  label: string;
  children?: NestedItem[];
};

export type NestedListProps = {
  items: NestedItem[];
  /** Highlighted node (controlled by the caller). */
  selectedId?: string;
  onSelect: (item: NestedItem) => void;
  className?: string;
};

function hasChildren(
  item: NestedItem,
): item is NestedItem & { children: NestedItem[] } {
  return Array.isArray(item.children) && item.children.length > 0;
}

/** True when `selectedId` sits somewhere inside `item`'s subtree. */
function isAncestorOfSelected(
  item: NestedItem,
  selectedId: string | undefined,
): boolean {
  if (!selectedId || !item.children) return false;
  return item.children.some(
    (child) =>
      child.id === selectedId || isAncestorOfSelected(child, selectedId),
  );
}

type NestedRowsProps = {
  items: NestedItem[];
  level: number;
  selectedId: string | undefined;
  manualOpen: Record<string, boolean>;
  onToggle: (id: string, open: boolean) => void;
  onSelect: (item: NestedItem) => void;
};

function NestedRows({
  items,
  level,
  selectedId,
  manualOpen,
  onToggle,
  onSelect,
}: NestedRowsProps) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const children = hasChildren(item) ? item.children : null;
        const open = children
          ? (manualOpen[item.id] ?? isAncestorOfSelected(item, selectedId))
          : false;
        const isSelected = item.id === selectedId;

        return (
          <li key={item.id}>
            <div
              className="flex items-center gap-0.5"
              style={{ paddingLeft: `${level * 16}px` }}
            >
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-current={isSelected ? "true" : undefined}
                data-selected={isSelected ? "true" : undefined}
                className={cn(
                  "flex h-10 flex-1 items-center rounded-md px-2 text-left text-sm outline-none sm:h-8 max-sm:text-base hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  isSelected && "bg-accent font-medium text-accent-foreground",
                )}
              >
                <span className="truncate">{item.label}</span>
              </button>
              {children ? (
                <button
                  type="button"
                  aria-label={`${open ? "折叠" : "展开"} ${item.label}`}
                  aria-expanded={open}
                  data-slot="nested-list-toggle"
                  onClick={() => onToggle(item.id, !open)}
                  className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 flex size-10 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-3 sm:size-8"
                >
                  <ChevronRight
                    className={cn(
                      "size-4 transition-transform",
                      open && "rotate-90",
                    )}
                  />
                </button>
              ) : null}
            </div>
            {children && open ? (
              <NestedRows
                items={children}
                level={level + 1}
                selectedId={selectedId}
                manualOpen={manualOpen}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Collapsible directory tree (bookmarks list / TOC).
 * Behaviour ported from the legacy MUI `nestedList.tsx`: ancestors of the
 * selected node open automatically, manual toggles survive until `selectedId`
 * changes, and selecting a node calls `onSelect`.
 */
export function NestedList({
  items,
  selectedId,
  onSelect,
  className,
}: NestedListProps) {
  const [currentId, setCurrentId] = React.useState(selectedId);
  const [manualOpen, setManualOpen] = React.useState<Record<string, boolean>>(
    {},
  );
  const [previousSelectedId, setPreviousSelectedId] =
    React.useState(selectedId);

  // when `selectedId` changes (prop → state), drop manual open overrides and
  // follow the new selection (render-phase adjustment, no cascading effect)
  if (previousSelectedId !== selectedId) {
    setPreviousSelectedId(selectedId);
    setCurrentId(selectedId);
    setManualOpen({});
  }

  const handleToggle = React.useCallback((id: string, open: boolean) => {
    setManualOpen((previous) => ({ ...previous, [id]: open }));
  }, []);

  const handleSelect = React.useCallback(
    (item: NestedItem) => {
      setCurrentId(item.id);
      onSelect(item);
    },
    [onSelect],
  );

  return (
    <nav aria-label="目录" className={cn("flex flex-col", className)}>
      <NestedRows
        items={items}
        level={0}
        selectedId={currentId}
        manualOpen={manualOpen}
        onToggle={handleToggle}
        onSelect={handleSelect}
      />
    </nav>
  );
}
