import { createFileRoute } from "@tanstack/react-router";

/**
 * Catch-all for /api/* so unknown API paths answer with JSON instead of the
 * router's HTML "Not Found" document.
 */
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      // `ANY` keeps an undeclared method on an unknown API path on the JSON
      // contract too (D1): the path is unknown, so it is still a 404.
      ANY: notFound,
      GET: notFound,
      POST: notFound,
      PUT: notFound,
      PATCH: notFound,
      DELETE: notFound,
    },
  },
});

function notFound({ params }: { params: { _splat?: string } }) {
  return Response.json(
    { error: "not_found", splat: params._splat ?? "" },
    { status: 404 },
  );
}
