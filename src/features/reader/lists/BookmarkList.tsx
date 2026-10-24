import { MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Item, ItemActions, ItemGroup } from "@/components/ui/item";

import type { ReadingMark } from "../epub/types";

export type BookmarkListProps = {
  bookmarks: readonly ReadingMark[];
  /** Jump the rendition to the bookmark. */
  onSelect: (mark: ReadingMark) => void;
  /** Remove the bookmark from the server *and* from the rendition. */
  onRemove: (mark: ReadingMark) => void;
  /** Open the title dialog, prefilled with the current title. */
  onRename: (mark: ReadingMark) => void;
};

/** 「书签」页签：标题、选中原文、⋮ 修改标题 / 删除。 */
export function BookmarkList({
  bookmarks,
  onSelect,
  onRemove,
  onRename,
}: BookmarkListProps) {
  return (
    <ItemGroup className="gap-0">
      {bookmarks.map((mark) => (
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
            <span className="line-clamp-1 w-full text-sm font-medium">
              {mark.title}
            </span>
            <span className="line-clamp-2 text-sm font-normal">
              {mark.selectedString}
            </span>
          </button>
          <ItemActions className="py-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="max-sm:size-9"
                    aria-label="书签操作"
                  />
                }
              >
                <MoreVertical />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onRename(mark)}>
                  修改标题
                </DropdownMenuItem>
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
