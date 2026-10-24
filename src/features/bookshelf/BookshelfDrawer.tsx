import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  BookIcon,
  LogOutIcon,
  PlusIcon,
  SettingsIcon,
  TagIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { DialogKb } from "@/components/dialog-kb";
import { toast } from "@/components/sonner-toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { ShelfPrefs } from "@/lib/prefs";
import { errorMessage } from "@/lib/utils";
import { createCategory } from "@/server/fns/categories";
import { logout } from "@/server/fns/session";
import { invalidateCategories } from "./queries";
import type { BookshelfCategory } from "./types";

export type BookshelfDrawerProps = {
  categories: readonly BookshelfCategory[];
  /** `0` means "我的书籍"; otherwise the selected category id. */
  selected: number;
  onSelect: (id: number) => void;
  /** 窄屏上顶栏放不下排序控件，抽屉里必须有同一个入口（服务端顺序为「最近添加」）。 */
  sort: ShelfPrefs["sort"];
  onSortChange: (sort: ShelfPrefs["sort"]) => void;
  /** Called before an action that should close the mobile sheet. */
  onNavigate?: () => void;
};

type NavItemProps = {
  icon: ReactNode;
  label: string;
  selected?: boolean;
  destructive?: boolean;
  onClick: () => void;
};

function NavItem({
  icon,
  label,
  selected,
  destructive,
  onClick,
}: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={
        destructive
          ? "text-destructive hover:bg-destructive/10 focus-visible:ring-ring/40 flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-base outline-none focus-visible:ring-2 lg:h-8"
          : "hover:bg-hover focus-visible:ring-ring/40 aria-current:bg-active aria-current:text-foreground text-muted-foreground aria-current:text-foreground flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-base outline-none focus-visible:ring-2 aria-current:font-semibold lg:h-8"
      }
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Bookshelf navigation: "我的书籍", the category list, "创建分类", "设置" and
 * "退出登陆" (PRD §5.2). Rendered twice — permanently in the `sm`+ sidebar and
 * inside the mobile sheet — so it owns only its own dialogs and mutations.
 */
export function BookshelfDrawer({
  categories,
  selected,
  onSelect,
  sort,
  onSortChange,
  onNavigate,
}: BookshelfDrawerProps) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [categoryName, setCategoryName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const createMutation = useMutation({
    mutationFn: (name: string) => createCategory({ data: { name } }),
    onSuccess: () => {
      setCreateOpen(false);
      setCategoryName("");
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => {
      void invalidateCategories(client);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: async () => {
      // Drop every cached payload of the account that just signed out.
      client.clear();
      await navigate({ to: "/login" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const goToSetting = () => {
    onNavigate?.();
    void navigate({ to: "/setting" });
  };

  return (
    <div className="flex h-full flex-col gap-0.5 overflow-y-auto p-3">
      <p className="mb-2 px-3 py-1 text-base font-semibold tracking-tight">
        Beryllium
      </p>

      <NavItem
        icon={<BookIcon className="size-4" />}
        label="我的书籍"
        selected={selected === 0}
        onClick={() => {
          onNavigate?.();
          onSelect(0);
        }}
      />

      {/* 窄屏上顶栏放不下排序，这里必须能改（原型也是把排序放在侧栏）。 */}
      <div className="mt-2 flex flex-col gap-1.5 px-3 md:hidden">
        <p className="text-faint text-xs font-medium">排序</p>
        <Segmented
          aria-label="排序"
          value={sort}
          options={[
            { value: "recent", label: "最近阅读" },
            { value: "added", label: "最近添加" },
            { value: "title", label: "书名" },
            { value: "author", label: "作者" },
          ]}
          onValueChange={onSortChange}
          className="self-start"
        />
      </div>

      <Separator className="bg-line my-2" />
      <p className="text-faint px-3 pt-1 pb-1.5 text-xs font-medium">分类</p>

      {categories.map((category) => (
        <NavItem
          key={category.id}
          icon={<TagIcon className="size-4" />}
          label={category.name}
          selected={category.id === selected}
          onClick={() => {
            onNavigate?.();
            onSelect(category.id);
          }}
        />
      ))}

      <NavItem
        icon={<PlusIcon className="size-4" />}
        label="创建分类"
        onClick={() => {
          onNavigate?.();
          setCreateOpen(true);
        }}
      />

      <Separator className="bg-line my-2" />

      <NavItem
        icon={<SettingsIcon className="size-4" />}
        label="设置"
        onClick={goToSetting}
      />
      <NavItem
        icon={<LogOutIcon className="size-4" />}
        label="退出登陆"
        destructive
        onClick={() => logoutMutation.mutate()}
      />

      <DialogKb open={createOpen} onOpenChange={setCreateOpen} title="添加类别">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-name">输入类别名称</Label>
          <Input
            id="category-name"
            autoFocus
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (categoryName.trim() === "") return;
              createMutation.mutate(categoryName.trim());
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCategoryName("");
              setCreateOpen(false);
            }}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={categoryName.trim() === "" || createMutation.isPending}
            onClick={() => createMutation.mutate(categoryName.trim())}
          >
            {createMutation.isPending ? <Spinner className="size-4" /> : null}
            创建
          </Button>
        </div>
      </DialogKb>
    </div>
  );
}
