import { RequestError } from "./domain/errors";

/**
 * HTTP methods that mutate state, i.e. the ones that need a same-origin proof.
 * Safe methods (GET/HEAD/OPTIONS) are exempt: a cross-site `<img>` or top-level
 * navigation may legitimately fetch a book file, and it cannot change anything.
 */
const UNSAFE_METHODS: Record<string, true> = {
  POST: true,
  PUT: true,
  PATCH: true,
  DELETE: true,
};

/**
 * CSRF guard for the REST routes. TanStack Start's CSRF middleware is mounted
 * for server functions (`/_serverFn/*`) only, so every REST write needs its own
 * check (B3).
 *
 * The check mirrors `createCsrfMiddleware` and the Fetch Metadata spec:
 * `Sec-Fetch-Site` wins when the browser sent it (page script cannot forge it),
 * otherwise `Origin` is compared against the request's own origin. Missing both
 * headers on a write is refused rather than allowed, so a non-browser client
 * that wants to upload has to state its origin explicitly.
 */
export function assertSameOrigin(request: Request): void {
  if (UNSAFE_METHODS[request.method.toUpperCase()] !== true) return;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) {
    if (fetchSite === "same-origin") return;
    throw crossSiteRequest();
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    // Compare hosts rather than full origins: behind a TLS-terminating proxy the
    // browser sends `Origin: https://host` while the app sees `http://host`
    // (srvx only rewrites the URL when trust proxy is enabled). A different host
    // is what actually distinguishes a cross-site caller.
    const requestHost =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      new URL(request.url).host;
    try {
      if (new URL(origin).host === requestHost) return;
    } catch {
      // Malformed Origin: fall through to the rejection below.
    }
  }

  throw crossSiteRequest();
}

function crossSiteRequest(): RequestError {
  return new RequestError("FORBIDDEN", "跨站请求已被拒绝");
}
