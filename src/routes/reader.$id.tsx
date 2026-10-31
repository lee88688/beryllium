import { parseMarkSearchParam } from "@/lib/reader-mark";
import { serializeAnchor } from "@/lib/reader-anchor";
import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useMemo } from "react";
import { ReaderShell } from "@/features/reader/ReaderShell";

const PdfReader = lazy(() =>
  import("@/features/reader/PdfReader").then((module) => ({
    default: module.PdfReader,
  })),
);
import type { ReaderApi } from "@/features/reader/api";
import { getReaderData, updateBookCurrent } from "@/server/fns/books";
import { addMark, removeMark, updateMark } from "@/server/fns/marks";
import { me } from "@/server/fns/session";

export const Route = createFileRoute("/reader/$id")({
  validateSearch: (search: Record<string, unknown>): { mark?: number } =>
    parseMarkSearchParam(search.mark),
  beforeLoad: async () => {
    const user = await me();
    if (!user) throw redirect({ to: "/login", replace: true });
  },
  /**
   * One request for book + TOC + marks (replaces the legacy RSC prefetch). A
   * missing id, a non-numeric id, or a book that is not the caller's all end up
   * on the shelf — the server answers `NOT_FOUND` for every one of them.
   */
  loader: async ({ params }) => {
    const bookId = Number.parseInt(params.id, 10);
    if (!Number.isInteger(bookId) || bookId <= 0) {
      throw redirect({ to: "/bookshelf", replace: true });
    }
    try {
      return await getReaderData({ data: { bookId } });
    } catch {
      throw redirect({ to: "/bookshelf", replace: true });
    }
  },
  component: ReaderPage,
});

function ReaderPage() {
  const data = Route.useLoaderData();
  const { mark } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();

  /** Bridge from the reader shell to the server functions (see `reader/api.ts`). */
  const api = useMemo<ReaderApi>(
    () => ({
      addMark: (mark) => {
        // `ReaderApi` widens the kind to `string`; the server takes the union.
        if (mark.type !== "bookmark" && mark.type !== "highlight") {
          return Promise.reject(new Error(`未知的标记类型：${mark.type}`));
        }
        const { anchor, ...rest } = mark;
        return addMark({
          data: { ...rest, type: mark.type, ...serializeAnchor(anchor) },
        });
      },
      updateMark: async (mark) => {
        await updateMark({ data: mark });
      },
      removeMark: async (id) => {
        await removeMark({ data: { id } });
      },
      updateBookCurrent: async (bookId, current, percent) => {
        await updateBookCurrent({ data: { bookId, current, percent } });
      },
    }),
    [],
  );

  /**
   * The shell renders the mark lists from its props, so a mark mutation has to
   * re-run this route's loader (one `getReaderData` round trip). The rendition
   * itself is created once per mount, so the reader is not re-initialised.
   */
  const handleMarksChanged = useCallback(() => {
    void router.invalidate();
  }, [router]);

  const handleExit = useCallback(() => {
    // `ReaderShell` reports the current CFI before calling `onExit`.
    void navigate({ to: "/bookshelf" });
  }, [navigate]);

  return data.book.format === "pdf" ? (
    <Suspense
      fallback={
        <div className="text-muted grid h-dvh place-items-center text-sm">
          正在打开 PDF…
        </div>
      }
    >
      <PdfReader
        data={data}
        api={api}
        initialMarkId={mark}
        onMarksChanged={handleMarksChanged}
        onExit={handleExit}
      />
    </Suspense>
  ) : (
    <ReaderShell
      book={data.book}
      toc={data.toc}
      highlights={data.highlights}
      bookmarks={data.bookmarks}
      api={api}
      initialMarkId={mark}
      onMarksChanged={handleMarksChanged}
      onExit={handleExit}
    />
  );
}
