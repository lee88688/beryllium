import type { z } from "zod";
import { RequestError } from "@/server/domain/errors";

/**
 * zod schema as a Start server-function validator. Differences from passing
 * the schema itself: the first issue is reported as a `RequestError`
 * (`BAD_REQUEST`, 400) with the offending path, instead of an opaque 500
 * carrying raw JSON issues, and `data` in the handler is the parsed output.
 */
export function inputValidator<TInput, TOutput>(
  schema: z.ZodType<TOutput, z.ZodTypeDef, TInput>,
) {
  return {
    types: {
      input: undefined as unknown as TInput,
      output: undefined as unknown as TOutput,
    },
    parse: (input: unknown): TOutput => {
      const result = schema.safeParse(input);
      if (result.success) return result.data;

      const issue = result.error.issues[0];
      const where = issue?.path.join(".");
      throw new RequestError(
        "BAD_REQUEST",
        issue === undefined
          ? "请求参数不合法"
          : `${where ? `${where}: ` : ""}${issue.message}`,
      );
    },
  };
}
