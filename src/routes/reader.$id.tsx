import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { ReaderShell } from "@/features/reader/ReaderShell";
import type { ReaderApi } from "@/features/reader/api";
import { getReaderData, updateBookCurrent } from "@/server/fns/books";
import { addMark, removeMark, updateMark } from "@/server/fns/marks";
import { me } from "@/server/fns/session";

export const Route = createFileRoute("/reader/$id")({
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
        return addMark({ data: { ...mark, type: mark.type } });
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

  return (
    <ReaderShell
      book={data.book}
      toc={data.toc}
      highlights={data.highlights}
      bookmarks={data.bookmarks}
      api={api}
      onMarksChanged={handleMarksChanged}
      onExit={handleExit}
    />
  );
}
