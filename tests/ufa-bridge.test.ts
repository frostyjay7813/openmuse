/**
 * FIXTURE TESTS. Every UFA response in this file is produced by an in-process
 * stub. These tests are not a live integration and do not show the bridge is connected.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { type Config, readConfig } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  isPermittedUfaRequest,
  normalizeBaseUrl,
  readUfaBridgeConfig,
  UfaAdapter,
  type UfaView,
} from "../packages/backends/src/ufa.ts";

const KEY = "fixture-ufa-key-do-not-leak";
const TASK = "task_0123456789abcdef";
const RUN = "run_0123456789abcdef";
const EVENT = "evt_0123456789abcdef";
const ART = "art_0123456789abcdef";
const HASH = "ab".repeat(32);
const MARKER = "openmuse-sensitive-marker";
const ORIGIN = "http://127.0.0.1:8000";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const sampleConfig = {
  mode: "sample" as const,
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  agentBackend: "sample" as const,
  intelligenceApiKey: "test-project-key-never-sent",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: ["http://localhost:8081"],
};

test("UFA bridge configuration is disabled by default and fail-closed when enabled", () => {
  assert.equal(readUfaBridgeConfig({}).enabled, false);
  assert.equal(readUfaBridgeConfig({ UFA_BRIDGE_ENABLED: "false" }).enabled, false);
  assert.throws(() => readUfaBridgeConfig({ UFA_BRIDGE_ENABLED: "true" }), /UFA_BASE_URL/);
  assert.throws(() => normalizeBaseUrl("http://user:pass@127.0.0.1:8000"), /credentials/);
  assert.throws(() => normalizeBaseUrl("http://10.1.2.3:8000"), /https/);
  assert.throws(() => normalizeBaseUrl("https://ufa.example/api"), /origin/);
  assert.throws(() => normalizeBaseUrl("https://ufa.example/?next=/api/keys"), /origin/);
  const config = readUfaBridgeConfig({
    UFA_BRIDGE_ENABLED: "true",
    UFA_BASE_URL: "http://127.0.0.1:8000/",
    UFA_API_KEY: KEY,
    UFA_BRIDGE_ALLOWED_OWNER: "local-user",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, ORIGIN);
  assert.equal(config.allowedOwner, "local-user");
  assert.throws(
    () =>
      readUfaBridgeConfig({
        UFA_BRIDGE_ENABLED: "true",
        UFA_BASE_URL: ORIGIN,
        UFA_API_KEY: "short key",
        UFA_BRIDGE_ALLOWED_OWNER: "local-user",
      }),
    /UFA_API_KEY/,
  );
});

test("startup rejects an enabled bridge with a missing key and ignores it when disabled", () => {
  const keys = [
    "WORKSPACE_MODE",
    "HOST",
    "AGENT_BACKEND",
    "CPK_INTELLIGENCE_API_KEY",
    "UFA_BRIDGE_ENABLED",
    "UFA_BASE_URL",
    "UFA_API_KEY",
    "UFA_BRIDGE_ALLOWED_OWNER",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.WORKSPACE_MODE = "sample";
    process.env.HOST = "127.0.0.1";
    process.env.AGENT_BACKEND = "sample";
    process.env.CPK_INTELLIGENCE_API_KEY = "test-project-key-never-sent";
    delete process.env.UFA_BRIDGE_ENABLED;
    delete process.env.UFA_BASE_URL;
    delete process.env.UFA_API_KEY;
    delete process.env.UFA_BRIDGE_ALLOWED_OWNER;
    assert.equal(readConfig().ufa?.enabled, false);
    process.env.UFA_BRIDGE_ENABLED = "true";
    process.env.UFA_BASE_URL = "https://ufa.example";
    delete process.env.UFA_API_KEY;
    assert.throws(() => readConfig(), /UFA_API_KEY/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("only the documented GET paths are permitted", () => {
  assert.equal(isPermittedUfaRequest("GET", "/api/tasks"), true);
  assert.equal(isPermittedUfaRequest("GET", `/api/tasks/${TASK}`), true);
  assert.equal(isPermittedUfaRequest("GET", `/api/tasks/${TASK}/events`), true);
  assert.equal(isPermittedUfaRequest("GET", `/api/tasks/${TASK}/bundle`), true);
  assert.equal(isPermittedUfaRequest("GET", "/api/runs"), true);
  assert.equal(isPermittedUfaRequest("GET", `/api/runs/${RUN}`), true);
  for (const [method, path] of [
    ["POST", "/api/tasks"],
    ["PUT", `/api/tasks/${TASK}`],
    ["PATCH", `/api/tasks/${TASK}`],
    ["DELETE", `/api/runs/${RUN}`],
    ["GET", "/api/keys"],
    ["GET", "/api/tasks?redact=false"],
    ["GET", `/api/tasks/${TASK}/verify`],
    ["GET", `/api/tasks/${TASK}/transition`],
    ["GET", `/api/artifacts/${ART}`],
    ["GET", "/api/tasks/../keys"],
    ["GET", "https://evil.example/api/tasks"],
  ] as const) {
    assert.equal(isPermittedUfaRequest(method, path), false, `${method} ${path}`);
  }
});

test("fixture: a disabled or incomplete adapter makes no outbound request", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error("should not be called");
  };
  const disabled = new UfaAdapter({ fetch: fetchImpl, evidence: "fixture" });
  assert.equal((await disabled.overview()).connection, "disabled");
  const incomplete = new UfaAdapter({
    enabled: true,
    evidence: "fixture",
    fetch: fetchImpl,
  });
  assert.equal((await incomplete.overview()).connection, "unavailable");
  assert.equal((await incomplete.task(TASK)).connection, "unavailable");
  assert.equal(calls, 0);
  assert.equal(disabled.idleView().evidence, "fixture");
  assert.equal(new UfaAdapter().idleView().evidence, "unverified");
});

test("fixture: redirects, timeouts, malformed bodies, and oversize responses fail without leaking", async () => {
  const calls: string[] = [];
  const redirecting: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(null, {
      status: 302,
      headers: { location: "http://evil.example/api/tasks" },
    });
  };
  const adapter = new UfaAdapter({
    enabled: true,
    baseUrl: ORIGIN,
    apiKey: KEY,
    evidence: "fixture",
    fetch: redirecting,
  });
  const redirected = adapter.failureView(await adapter.overview().catch((error: unknown) => error));
  assert.equal(redirected.connection, "unavailable");
  assert.match(redirected.reason ?? "", /redirects are not followed/);
  assert.ok(calls.length >= 1);
  assert.equal(
    calls.some((url) => url.includes("evil.example")),
    false,
  );
  assert.equal(
    calls.every((url) => new URL(url).origin === ORIGIN),
    true,
  );
  assert.equal(JSON.stringify(redirected).includes("evil.example"), false);
  assert.equal(JSON.stringify(redirected).includes(KEY), false);

  const hanging: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason ?? new Error("aborted"));
      });
    });
  const slow = new UfaAdapter({
    enabled: true,
    baseUrl: ORIGIN,
    apiKey: KEY,
    timeoutMs: 20,
    evidence: "fixture",
    fetch: hanging,
  });
  const timed = slow.failureView(await slow.overview().catch((error: unknown) => error));
  assert.match(timed.reason ?? "", /did not respond in time/);

  const malformed: typeof fetch = async () =>
    new Response(`{"nope":"${MARKER}"}`, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const broken = new UfaAdapter({
    enabled: true,
    baseUrl: ORIGIN,
    apiKey: KEY,
    evidence: "fixture",
    fetch: malformed,
  });
  const invalid = broken.failureView(await broken.overview().catch((error: unknown) => error));
  assert.equal(invalid.connection, "unavailable");
  assert.equal(JSON.stringify(invalid).includes(MARKER), false);

  const huge: typeof fetch = async () => json({ tasks: [], pad: "x".repeat(200) });
  const oversized = new UfaAdapter({
    enabled: true,
    baseUrl: ORIGIN,
    apiKey: KEY,
    maxBytes: 32,
    evidence: "fixture",
    fetch: huge,
  });
  const limited = oversized.failureView(
    await oversized.overview().catch((error: unknown) => error),
  );
  assert.match(limited.reason ?? "", /size limit/);
  assert.equal(JSON.stringify(limited).includes("xxxxx"), false);
});

test("fixture: observed task and run data keeps source status and drops payloads", async () => {
  const calls: {
    url: string;
    method: string;
    authorization: string | null;
    redirect: RequestRedirect | undefined;
  }[] = [];
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map((item) => String(item)).join(" "));
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url: url.toString(),
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
    });
    if (url.pathname === "/api/tasks") {
      return json({
        tasks: [
          {
            id: TASK,
            title: `${KEY} visible`,
            state: "RUNNING",
            created_at: "2026-10-13T10:00:00+00:00",
            updated_at: "2026-10-13T10:05:00+00:00",
            session_id: "sess_0123456789abcdef",
          },
        ],
      });
    }
    if (url.pathname === "/api/runs") {
      return json({
        runs: [
          {
            id: RUN,
            task_id: TASK,
            status: "running",
            result: { secret: MARKER, key: KEY },
            goal: MARKER,
            created_at: "2026-10-13T10:01:00+00:00",
            finished_at: null,
          },
        ],
      });
    }
    if (url.pathname === `/api/tasks/${TASK}`) {
      return json({
        id: TASK,
        title: "Observe only",
        state: "RUNNING",
        created_at: "2026-10-13T10:00:00+00:00",
        updated_at: "2026-10-13T10:05:00+00:00",
      });
    }
    if (url.pathname === `/api/tasks/${TASK}/events`) {
      return json({
        events: [
          {
            id: EVENT,
            type: "tool.output",
            task_id: TASK,
            created_at: "2026-10-13T10:02:00+00:00",
            payload: { password: MARKER, authorization: KEY },
          },
        ],
      });
    }
    if (url.pathname === `/api/tasks/${TASK}/bundle`) {
      return json({
        task_id: TASK,
        created_at: "2026-10-13T10:06:00+00:00",
        manifest_sha256: HASH,
        signature: "not-a-verification",
        events: [{ payload: { password: MARKER } }],
        artifacts: [{ id: ART, name: "secret.txt", content_hash: HASH, bytes: MARKER }],
        verifications: [{}],
        approvals: [{ decided_by: MARKER }],
      });
    }
    if (url.pathname === `/api/runs/${RUN}`) {
      return json({
        id: RUN,
        task_id: TASK,
        status: "failed",
        created_at: "2026-10-13T10:01:00+00:00",
        finished_at: "2026-10-13T10:03:00+00:00",
        result: MARKER,
        steps: [{ payload: { secret: MARKER } }],
      });
    }
    return json({ detail: "no" }, 404);
  };
  try {
    const adapter = new UfaAdapter({
      enabled: true,
      baseUrl: ORIGIN,
      apiKey: KEY,
      evidence: "fixture",
      fetch: fetchImpl,
    });
    const overview = await adapter.overview();
    const task = await adapter.task(TASK);
    const run = await adapter.run(RUN);
    const encoded = JSON.stringify({ overview, task, run, logs });
    assert.equal(overview.connection, "observed");
    assert.equal(overview.live, false);
    assert.equal(overview.disposition, "NOT_CONNECTED");
    assert.equal(overview.evidence, "fixture");
    assert.equal(overview.tasks?.[0]?.state, "RUNNING");
    assert.equal(overview.tasks?.[0]?.created_at, "2026-10-13T10:00:00+00:00");
    assert.equal(overview.tasks?.[0]?.title, "[redacted] visible");
    assert.equal(overview.runs?.[0]?.status, "running");
    assert.equal(task.events?.[0]?.payloadOmitted, true);
    assert.equal(task.events?.[0]?.type, "tool.output");
    assert.equal(
      task.bundle && "signatureVerified" in task.bundle && task.bundle.signatureVerified,
      false,
    );
    assert.equal(
      task.bundle && "signaturePresent" in task.bundle && task.bundle.signaturePresent,
      true,
    );
    assert.equal(task.bundle && "eventCount" in task.bundle && task.bundle.eventCount, 1);
    assert.equal(run.run?.status, "failed");
    assert.equal(encoded.includes(KEY), false);
    assert.equal(encoded.includes(MARKER), false);
    assert.equal(encoded.includes("not-a-verification"), false);
    assert.equal(encoded.includes('"payload"'), false);
    for (const call of calls) {
      assert.equal(call.method, "GET");
      assert.equal(call.redirect, "manual");
      assert.equal(call.authorization, `Bearer ${KEY}`);
      const url = new URL(call.url);
      assert.equal(url.origin, ORIGIN);
      assert.equal(url.searchParams.get("redact"), null);
      assert.equal(isPermittedUfaRequest("GET", url.pathname), true);
    }
    await assert.rejects(adapter.task("../keys"), /not allowed/);
    assert.equal(
      calls.some((call) => call.url.includes("keys")),
      false,
    );
  } finally {
    console.error = original;
  }
});

test("the mobile client does not contain the UFA key setting or a fixture key", async () => {
  const root = join(import.meta.dirname, "../apps/mobile");
  const paths = await sourceFiles(root);
  assert.ok(paths.some((path) => path.endsWith("ufa-screen.tsx")));
  for (const path of paths) {
    const text = await readFile(path, "utf8");
    assert.equal(text.includes("UFA_API_KEY"), false, path);
    assert.equal(text.includes(KEY), false, path);
    assert.equal(text.includes("UFA_BASE_URL"), false, path);
  }
});

describe("UFA bridge HTTP routes (fixtures, not live evidence)", { concurrency: 1 }, () => {
  let db: Store;
  let directory: string;
  let app: Awaited<ReturnType<typeof createApp>>["app"];
  let denied: Awaited<ReturnType<typeof createApp>>["app"];
  let disabled: Awaited<ReturnType<typeof createApp>>["app"];
  let token: string;
  let calls: string[];
  let mode: "ok" | "unauthorized" | "missing" = "ok";

  const headers = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "openmuse-ufa-"));
    db = await createStore();
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      const url = new URL(String(input));
      if (mode === "unauthorized") return json({ detail: KEY }, 401);
      if (mode === "missing") return json({ detail: "missing" }, 404);
      if (url.pathname === "/api/tasks") {
        return json({
          tasks: [
            {
              id: TASK,
              title: "Observe only",
              state: "REQUESTED",
              created_at: "2026-10-13T10:00:00+00:00",
              updated_at: "2026-10-13T10:00:00+00:00",
            },
          ],
        });
      }
      if (url.pathname === "/api/runs") return json({ runs: [] });
      if (url.pathname === `/api/tasks/${TASK}`) {
        return json({
          id: TASK,
          title: "Observe only",
          state: "REQUESTED",
          created_at: "2026-10-13T10:00:00+00:00",
          updated_at: "2026-10-13T10:00:00+00:00",
        });
      }
      if (url.pathname === `/api/tasks/${TASK}/events`) {
        return json({
          events: [
            {
              id: EVENT,
              type: "note",
              task_id: TASK,
              created_at: "2026-10-13T10:02:00+00:00",
              payload: { secret: MARKER },
            },
          ],
        });
      }
      if (url.pathname === `/api/tasks/${TASK}/bundle`) return json({ detail: "none" }, 501);
      return json({ detail: "unmapped" }, 404);
    };
    const enabled: Config = {
      ...sampleConfig,
      dataDir: directory,
      ufa: {
        enabled: true,
        baseUrl: ORIGIN,
        apiKey: KEY,
        allowedOwner: "local-user",
        timeoutMs: 5_000,
        maxBytes: 512_000,
      },
    };
    ({ app } = await createApp(db, enabled, { ufaFetch: fetchImpl, ufaEvidence: "fixture" }));
    ({ app: denied } = await createApp(
      db,
      {
        ...enabled,
        ufa: {
          enabled: true,
          baseUrl: ORIGIN,
          apiKey: KEY,
          allowedOwner: "other-owner",
          timeoutMs: 5_000,
          maxBytes: 512_000,
        },
      },
      { ufaFetch: fetchImpl, ufaEvidence: "fixture" },
    ));
    ({ app: disabled } = await createApp(
      db,
      { ...enabled, ufa: { enabled: false, timeoutMs: 5_000, maxBytes: 512_000 } },
      { ufaFetch: fetchImpl, ufaEvidence: "fixture" },
    ));
    const session = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(session.status, 200);
    token = ((await session.json()) as { token: string }).token;
  });

  beforeEach(() => {
    calls = [];
    mode = "ok";
  });

  after(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });

  test("unauthenticated, disabled, and wrong-owner reads do not call UFA", async () => {
    assert.equal((await app.request("/api/ufa/overview")).status, 401);
    const off = await disabled.request("/api/ufa/overview", { headers: headers() });
    const offBody = (await off.json()) as UfaView;
    assert.equal(off.status, 200);
    assert.equal(offBody.connection, "disabled");
    assert.equal(offBody.live, false);
    assert.equal(offBody.tasks, undefined);
    const forbidden = await denied.request("/api/ufa/overview", { headers: headers() });
    assert.equal(forbidden.status, 403);
    const forbiddenBody = (await forbidden.json()) as { live: boolean };
    assert.equal(forbiddenBody.live, false);
    assert.equal(JSON.stringify(forbiddenBody).includes(KEY), false);
    assert.deepEqual(calls, []);
  });

  test("fixture reads stay on the allowlist and writes are rejected", async () => {
    const overview = await app.request("/api/ufa/overview", { headers: headers() });
    const body = (await overview.json()) as UfaView;
    assert.equal(overview.status, 200);
    assert.equal(body.connection, "observed");
    assert.equal(body.live, false);
    assert.equal(body.evidence, "fixture");
    assert.equal(body.disposition, "NOT_CONNECTED");
    assert.equal(body.tasks?.[0]?.state, "REQUESTED");
    assert.equal(JSON.stringify(body).includes(KEY), false);
    const posted = await app.request("/api/ufa/tasks", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "no" }),
    });
    assert.equal(posted.status, 405);
    const weird = await app.request("/api/ufa/tasks/not-an-id", { headers: headers() });
    assert.equal(weird.status, 400);
    const unmapped = await app.request("/api/ufa/keys", { headers: headers() });
    assert.equal(unmapped.status, 404);
    for (const call of calls) {
      assert.match(call, /^GET /);
      const url = new URL(call.slice(4));
      assert.equal(url.origin, ORIGIN);
      assert.equal(isPermittedUfaRequest("GET", url.pathname), true);
    }
    assert.equal(
      calls.some((call) => call.includes("/api/keys")),
      false,
    );
  });

  test("fixture task view omits payloads and does not treat a missing bundle as verified", async () => {
    const response = await app.request(`/api/ufa/tasks/${TASK}`, { headers: headers() });
    const body = (await response.json()) as UfaView;
    assert.equal(response.status, 200);
    assert.equal(body.connection, "observed");
    assert.equal(body.events?.[0]?.payloadOmitted, true);
    assert.equal(body.bundle && "available" in body.bundle && body.bundle.available, false);
    const encoded = JSON.stringify(body);
    assert.equal(encoded.includes(MARKER), false);
    assert.equal(encoded.includes('signatureVerified":true'), false);
    mode = "unauthorized";
    const refused = await app.request("/api/ufa/overview", { headers: headers() });
    const refusedBody = (await refused.json()) as UfaView;
    assert.equal(refusedBody.connection, "unavailable");
    assert.equal(refusedBody.tasks, undefined);
    assert.equal(JSON.stringify(refusedBody).includes(KEY), false);
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) paths.push(path);
  }
  return paths;
}
