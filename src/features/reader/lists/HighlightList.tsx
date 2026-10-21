import { MoreVertical } from "lucide-react";

import { getMarkColorValue } from "@/components/color-radio";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Item, ItemActions, ItemGroup } from "@/components/ui/item";

import type { ReadingMark } from "../epub/types";

export type HighlightListProps = {
  highlights: readonly ReadingMark[];
  /** Jump the rendition to the mark. */
  onSelect: (mark: ReadingMark) => void;
  /** Remove the mark from the server *and* from the rendition. */
  onRemove: (mark: ReadingMark) => void;
};

/** 「备注」页签：标题、选中原文、批注、⋮ 删除。 */
export function HighlightList({
  highlights,
  onSelect,
  onRemove,
}: HighlightListProps) {
  return (
    <ItemGroup className="gap-0">
      {highlights.map((mark) => (
        <Item
          key={mark.id}
          size="sm"
          className="border-border items-start gap-1 rounded-none border-b px-1 py-1"
        >
          <button
            type="button"
            onClick={() => onSelect(mark)}
            className="hover:bg-muted/60 focus-visible:ring-ring/50 flex min-w-0 flex-1 flex-col gap-1 rounded-md px-1 py-2 text-left outline-none focus-visible:ring-3"
          >
            <span className="flex w-full items-center gap-2 text-sm font-medium">
              <span
                aria-hidden="true"
                className="ring-background size-2.5 shrink-0 rounded-full ring-2"
                style={{
                  backgroundColor:
                    getMarkColorValue(mark.color) ?? "transparent",
                }}
              />
              <span className="line-clamp-1">{mark.title}</span>
            </span>
            <span className="line-clamp-2 text-sm font-normal">
              {mark.selectedString}
            </span>
            {mark.content ? (
              <span className="mt-1 flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs">批注</span>
                <span className="text-sm font-normal">{mark.content}</span>
              </span>
            ) : null}
          </button>
          <ItemActions className="py-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="高亮操作"
                  />
                }
              >
                <MoreVertical />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onRemove(mark)}
                >
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}
