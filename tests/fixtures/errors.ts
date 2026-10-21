import { expect } from "vitest";
import { RequestError } from "@/server/domain/errors";

/**
 * Runs `run` and returns the `RequestError` it threw, failing the test when it
 * succeeded or threw something else. Narrowing happens once, through
 * `instanceof`, so callers can read `.code`/`.status` without casts.
 */
export async function expectRequestError(
  run: () => Promise<unknown>,
): Promise<RequestError> {
  const caught: unknown = await run().then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(RequestError);
  if (!(caught instanceof RequestError)) {
    throw new Error(`expected a RequestError, got ${String(caught)}`);
  }
  return caught;
}
