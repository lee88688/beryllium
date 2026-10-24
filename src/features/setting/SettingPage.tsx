import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  LibraryIcon,
  LockIcon,
  PaletteIcon,
  UsersIcon,
} from "lucide-react";
import * as React from "react";
import { ThemeModeButton } from "@/components/theme-mode-button";
import { IconButton } from "@/components/ui/icon-button";
import type { SessionUser } from "@/features/auth";
import { LookSection } from "./LookSection";
import { PasswordCard } from "./PasswordCard";
import { ReadingSection } from "./ReadingSection";
import { ShelfSection } from "./ShelfSection";
import { UsersCard } from "./UsersCard";

/**
 * `/setting` (PRD §5.6)：分区导航 + 单区内容。
 *
 * 分区用 hash 定位（`/setting#reading`），因为阅读器里「排版」面板会链到这里；
 * 参数非法或没权限时退回第一个分区。普通账号看不到「用户」分区 —— 与路由守卫
 * 用同一个 `user.isAdmin` 判断。
 */
const SECTIONS = [
  { id: "look", label: "外观", Icon: PaletteIcon },
  { id: "reading", label: "阅读", Icon: BookOpenIcon },
  { id: "shelf", label: "书架", Icon: LibraryIcon },
  { id: "account", label: "账号", Icon: LockIcon },
  { id: "users", label: "用户", Icon: UsersIcon, adminOnly: true },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function SettingPage({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const isAdmin = user.isAdmin;
  const sections = React.useMemo(
    () => SECTIONS.filter((section) => !("adminOnly" in section) || isAdmin),
    [isAdmin],
  );
  const [section, setSection] = React.useState<SectionId>(
    () => sections[0]?.id ?? "look",
  );

  // 进页读 hash，之后跟着 hash 变（阅读器的链接、浏览器前进后退都能用）
  React.useEffect(() => {
    const applyHash = () => {
      const raw = window.location.hash.replace(/^#/, "");
      const match = sections.find((candidate) => candidate.id === raw);
      if (match) setSection(match.id);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [sections]);

  const select = (next: SectionId) => {
    setSection(next);
    window.history.replaceState(null, "", `#${next}`);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="h-bar border-line bg-background/95 sticky top-0 z-20 flex shrink-0 items-center gap-1 border-b px-2 backdrop-blur max-sm:px-3">
        <IconButton
          aria-label="返回书架"
          className="max-sm:size-11"
          onClick={() => {
            void navigate({ to: "/bookshelf" });
          }}
        >
          <ArrowLeftIcon />
        </IconButton>
        <h1 className="flex-1 truncate px-1 text-lg font-semibold">设置</h1>
        <ThemeModeButton className="max-sm:size-11" />
      </header>

      <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-5 px-3 py-4 sm:px-4 sm:py-6 md:flex-row md:gap-8">
        <nav
          aria-label="设置分区"
          className="-mx-3 flex shrink-0 flex-wrap gap-1 px-3 md:mx-0 md:w-[200px] md:flex-col md:gap-0.5 md:px-0"
        >
          {sections.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={id === section}
              onClick={() => select(id)}
              className="text-muted-foreground hover:bg-hover hover:text-foreground aria-current:bg-active aria-current:text-foreground flex h-10 shrink-0 items-center gap-2.5 rounded-full px-3 text-base whitespace-nowrap transition-colors aria-current:font-semibold md:h-[34px] md:rounded-md"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1 pb-10 md:max-w-[760px]">
          {section === "look" ? <LookSection /> : null}
          {section === "reading" ? <ReadingSection /> : null}
          {section === "shelf" ? <ShelfSection /> : null}
          {section === "account" ? <PasswordCard /> : null}
          {section === "users" && user.isAdmin ? <UsersCard /> : null}
        </main>
      </div>
    </div>
  );
}

export { SettingPage };
