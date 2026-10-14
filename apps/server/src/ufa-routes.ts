import { Hono } from "hono";
import { type UfaAdapter, UfaError } from "../../../packages/backends/src/ufa.ts";

const READ_METHODS = new Set(["GET", "HEAD"]);

/**
 * Authenticated OpenMuse routes in front of the read-only UFA adapter.
 * No handler accepts a caller-supplied UFA URL or method.
 */
export function ufaRoutes(adapter: UfaAdapter, allowedOwner?: string) {
  const app = new Hono<{ Variables: { owner: string } }>();
  app.on(["POST", "PUT", "PATCH", "DELETE"], "/", (c) => readOnly(c));
  app.on(["POST", "PUT", "PATCH", "DELETE"], "/*", (c) => readOnly(c));
  app.use("*", async (c, next) => {
    if (!READ_METHODS.has(c.req.method)) return readOnly(c);
    if (!adapter.configured) return c.json(adapter.idleView());
    if (!allowedOwner || c.get("owner") !== allowedOwner) {
      return c.json(
        {
          error: "This workspace cannot view UFA",
          disposition: "NOT_CONNECTED",
          evidence: adapter.evidence,
          live: false,
          connection: "unavailable",
        },
        403,
      );
    }
    await next();
  });
  app.get("/overview", (c) => observe(c, adapter, () => adapter.overview()));
  app.get("/tasks/:id", (c) => observe(c, adapter, () => adapter.task(c.req.param("id"))));
  app.get("/runs/:id", (c) => observe(c, adapter, () => adapter.run(c.req.param("id"))));
  app.all("/*", (c) =>
    c.json(
      {
        error: "UFA endpoint is not available",
        disposition: "NOT_CONNECTED",
        evidence: adapter.evidence,
        live: false,
        connection: "unavailable",
      },
      404,
    ),
  );
  return app;
}

function readOnly(c: { json: (body: unknown, status?: number) => Response }) {
  return c.json(
    {
      error: "UFA bridge is read-only",
      disposition: "NOT_CONNECTED",
      live: false,
      connection: "unavailable",
    },
    405,
  );
}

async function observe(
  c: { json: (body: unknown, status?: number) => Response },
  adapter: UfaAdapter,
  read: () => Promise<unknown>,
) {
  try {
    return c.json(await read());
  } catch (error) {
    if (error instanceof UfaError && error.code === "invalid_input") {
      return c.json(adapter.failureView(error), 400);
    }
    return c.json(adapter.failureView(error));
  }
}
