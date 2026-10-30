import {
  createStartHandler,
  defaultStreamHandler,
  createServerEntry as createCoreServerEntry,
} from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";

// Named export consumed by `server.mjs`: the runtime entry warms (migrations +
// admin seed) the same `getDb()` instance the request handlers use, so a bad
// migration or legacy database stops the process before it listens instead of
// failing the first request.
export { getDb } from "@/server/db/client";

type ServerEntry = { fetch: RequestHandler<Register> };

const fetch = createStartHandler(defaultStreamHandler);
const createServerEntry: (entry: ServerEntry) => ServerEntry =
  createCoreServerEntry<Register>;

export default createServerEntry({ fetch });
