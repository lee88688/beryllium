import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowed } from "@/server/method-not-allowed";

const startedAt = Date.now();

/**
 * Build detail an attacker would otherwise get for free from the public
 * endpoint: runtime versions, pid, uptime. Logged once at import time instead
 * of answered (B6) — `docker logs` and the orchestrator's probes already read
 * the process, an anonymous HTTP caller does not need to.
 */
console.info(
  `[health] beryllium up: node ${process.version} on ${process.platform}, pid ${process.pid}, started ${new Date(startedAt).toISOString()}`,
);

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      // Any other method is a client error, never the SPA shell (D1).
      ANY: () => methodNotAllowed(["GET", "HEAD"]),
      // Liveness only, and only the fields the contract promises (B6).
      GET: () => Response.json({ status: "ok" }),
    },
  },
});
