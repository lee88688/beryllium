import path from "node:path";
import { describe, expect, it } from "vitest";
import { RequestError } from "@/server/domain/errors";
import { safeJoin } from "@/server/domain/path";

const root = path.resolve("virtual-beryllium-root");

describe("safeJoin", () => {
  it("joins nested relative paths under the root", () => {
    expect(safeJoin(root, "OEBPS/text/chapter1.xhtml")).toBe(
      path.resolve(root, "OEBPS/text/chapter1.xhtml"),
    );
  });

  it("accepts backslash separators and normalizes them", () => {
    expect(safeJoin(root, "OEBPS\\images\\cover.png")).toBe(
      path.resolve(root, "OEBPS/images/cover.png"),
    );
  });

  it("keeps paths containing dots but no traversal segments", () => {
    expect(safeJoin(root, "a..b/c..d.txt")).toBe(
      path.resolve(root, "a..b/c..d.txt"),
    );
  });

  it("rejects zip-slip with a leading ../", () => {
    expect(() => safeJoin(root, "../escaped.txt")).toThrowError(RequestError);
    try {
      safeJoin(root, "../escaped.txt");
    } catch (error) {
      expect((error as RequestError).code).toBe("BAD_REQUEST");
      expect((error as RequestError).status).toBe(400);
    }
  });

  it("rejects traversal hidden in the middle of a path", () => {
    expect(() => safeJoin(root, "OEBPS/../../escaped.txt")).toThrowError(
      RequestError,
    );
    expect(() => safeJoin(root, "..\\escaped.txt")).toThrowError(RequestError);
  });

  it("rejects absolute paths, drive letters and UNC prefixes", () => {
    expect(() => safeJoin(root, "/etc/passwd")).toThrowError(RequestError);
    expect(() => safeJoin(root, "C:/Windows/system32")).toThrowError(
      RequestError,
    );
    expect(() => safeJoin(root, "C:\\Windows\\system32")).toThrowError(
      RequestError,
    );
    expect(() => safeJoin(root, "\\\\server\\share")).toThrowError(
      RequestError,
    );
  });

  it("rejects empty paths and NUL bytes", () => {
    expect(() => safeJoin(root, "")).toThrowError(RequestError);
    expect(() => safeJoin(root, "OEBPS/evil\0.txt")).toThrowError(RequestError);
  });
});
