import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  callServerFn,
  createAuthenticatedSession,
  createTestServer,
  epubFormData,
  failureMessage,
  parseResult,
  sampleEpubBytes,
  seedUser,
  type HttpSession,
  type TestServer,
} from "../fixtures/http";

/**
 * `updateMark` contract that no other test pins: a patch without any of the
 * mutable fields must be a no-op (it must not blank the row), and an unknown id
 * must fail.
 */

const idResult = z.object({ id: z.number() });
const markList = z.array(
  z.object({
    id: z.number(),
    color: z.string(),
    title: z.string(),
    content: z.string(),
    selectedString: z.string(),
  }),
);

let server: TestServer;
let http: HttpSession;
let bookId: number;

beforeAll(async () => {
  server = await createTestServer();
  const user = seedUser(server, "marks-reader");
  http = await createAuthenticatedSession(server, user.id);

  const upload = await http.fetch("/api/books", {
    method: "POST",
    body: epubFormData(sampleEpubBytes()),
  });
  expect(upload.status).toBe(201);
  bookId = z
    .object({ book: z.object({ id: z.number() }) })
    .parse(await upload.json()).book.id;
});

afterAll(async () => {
  await server.close();
});

async function addMark(
  fields: Partial<{ color: string; title: string; content: string }>,
): Promise<number> {
  const call = await callServerFn(http, "addMark", {
    bookId,
    type: "highlight",
    epubcfi: "epubcfi(/6/4!/4/2/1:0)",
    selectedString: "Body of chapter one.",
    ...fields,
  });
  return parseResult(call, idResult).id;
}

async function marks(): Promise<z.infer<typeof markList>> {
  return parseResult(
    await callServerFn(http, "getMarks", { bookId }),
    markList,
  );
}

describe("updateMark", () => {
  it("writes nothing for a patch with no mutable field", async () => {
    const id = await addMark({ color: "red", title: "Chapter 1", content: "" });
    // A real patch first, so "unchanged" is not the same as "never written".
    parseResult(
      await callServerFn(http, "updateMark", { id, content: "我的批注" }),
      idResult,
    );

    const before = (await marks()).find((mark) => mark.id === id);
    const call = await callServerFn(http, "updateMark", { id });

    expect(call.error).toBeUndefined();
    expect(parseResult(call, idResult)).toEqual({ id });
    expect((await marks()).find((mark) => mark.id === id)).toEqual(before);
  });

  it("keeps an explicitly empty string when it is sent", async () => {
    const id = await addMark({ color: "blue", content: "清除我" });

    parseResult(
      await callServerFn(http, "updateMark", { id, content: "" }),
      idResult,
    );

    const stored = (await marks()).find((mark) => mark.id === id);
    expect(stored?.content).toBe("");
    expect(stored?.color).toBe("blue");
  });

  it("fails with 标记不存在 for an unknown id", async () => {
    const call = await callServerFn(http, "updateMark", { id: 999_999 });

    expect(call.result).toBeUndefined();
    expect(failureMessage(call)).toContain("标记不存在");
  });
});
