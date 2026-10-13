import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

test("the test harness ignores the preview probe without hiding a real request", async () => {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const probe = await fetch(`${base}/`, {
    headers: { "user-agent": "grok-preview-probe" },
  });
  assert.equal(probe.status, 404);
  const legitimate = await fetch(`${base}/`);
  assert.equal(legitimate.status, 200);
  const session = await fetch(`${base}/sessions`);
  assert.equal(session.status, 200);
  assert.deepEqual(seen, ["GET /", "GET /sessions"]);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
