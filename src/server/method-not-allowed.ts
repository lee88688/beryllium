import { RequestError } from "./domain/errors";

/**
 * `405 Method Not Allowed` as a REST response (RFC 9110 §15.5.6).
 *
 * TanStack Start answers an undeclared method on a matched route by falling
 * through to the SPA shell, so `GET /api/books` came back as a 200 `text/html`
 * document (D1). Every API route therefore declares an `ANY` handler built from
 * this helper, which keeps "an API path never answers HTML" true and advertises
 * the methods the route accepts through `Allow`.
 */
export function methodNotAllowed(allowed: readonly string[]): Response {
  const allow = allowed.join(", ");
  const error = new RequestError(
    "METHOD_NOT_ALLOWED",
    `该接口不支持此请求方法，允许: ${allow}`,
  );
  return Response.json(
    { error: error.code, message: error.message },
    { status: error.status, headers: { allow } },
  );
}
