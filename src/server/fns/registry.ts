/**
 * Server-function registration anchor (local://migration-plan.md §5.1).
 *
 * TanStack Start only registers the server functions reachable from a compiled
 * module graph, so this barrel is imported for its side effect by a module that
 * is always in the graph (`src/routes/api/$.ts`). Every new `src/server/fns/*`
 * module must be added here, or its endpoint will not exist in the build.
 */
import "./books";
import "./categories";
import "./marks";
import "./session";
import "./users";
