/**
 * Transport-agnostic error contract shared by services, server functions and
 * REST routes. The code is the stable part callers branch on; the message is
 * meant for the user and is safe to surface.
 */
export const REQUEST_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "BAD_REQUEST",
  "PAYLOAD_TOO_LARGE",
  /**
   * Unexpected filesystem/database failure. The message stays generic on
   * purpose: internal detail (absolute paths, SQLite text) is logged server
   * side instead of being handed to the caller.
   */
  "INTERNAL",
] as const;

export type RequestErrorCode = (typeof REQUEST_ERROR_CODES)[number];

const HTTP_STATUS_BY_CODE: Record<RequestErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

export class RequestError extends Error {
  readonly code: RequestErrorCode;

  constructor(code: RequestErrorCode, message: string) {
    super(message);
    this.name = "RequestError";
    this.code = code;
  }

  /** HTTP status equivalent, used by the REST routes. */
  get status(): number {
    return HTTP_STATUS_BY_CODE[this.code];
  }
}

export function isRequestError(error: unknown): error is RequestError {
  return error instanceof RequestError;
}
