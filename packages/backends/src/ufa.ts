import { z } from "zod";

/** UFA revision this read contract was written against. Not a live-connection claim. */
export const UFA_CONTRACT_REF = "03c543230e4e983cf81c52cb1113164dbd2c47aa";

const ID_PATTERN = /^[a-z][a-z0-9]{0,15}_[0-9a-f]{12,16}$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const EVENT_TYPE =
  /^(?:unlisted|(?:task|tool|run|loop|plan|agent|security|session|channel|model|lease|budget|artifact|estop|scheduler|delegation|mission|soak|test)\.[a-z0-9_]{1,40})$/;

const idSchema = z.string().regex(ID_PATTERN);
const taskSchema = z
  .object({
    id: idSchema,
    state: z.string().min(1).max(64),
    created_at: z.string().min(1).max(64),
    updated_at: z.string().min(1).max(64),
  })
  .strict();
const eventSchema = z
  .object({
    id: idSchema,
    type: z.string().regex(EVENT_TYPE),
    task_id: idSchema,
    created_at: z.string().min(1).max(64),
  })
  .strict();
const evidenceSchema = z
  .object({
    task_id: idSchema,
    signature_present: z.literal(false),
    event_count: z.number().int().nonnegative().max(1_000_000),
    artifact_count: z.number().int().nonnegative().max(1_000_000),
    verification_count: z.number().int().nonnegative().max(1_000_000),
    approval_count: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();
const runSchema = z
  .object({
    id: idSchema,
    task_id: idSchema.optional(),
    status: z.string().min(1).max(64),
    created_at: z.string().min(1).max(64),
    finished_at: z.string().max(64),
  })
  .strict();

export type UfaEvidence = "fixture" | "unverified";
export type UfaConnection = "disabled" | "unavailable" | "observed";

export interface UfaTask {
  id: string;
  state: string;
  created_at: string;
  updated_at: string;
}
export interface UfaEventMeta {
  id: string;
  type: string;
  task_id: string;
  created_at: string;
  payloadOmitted: true;
}
export interface UfaBundleMeta {
  available: true;
  task_id: string;
  signaturePresent: false;
  signatureVerified: false;
  eventCount: number;
  artifactCount: number;
  verificationCount: number;
  approvalCount: number;
}
export interface UfaRun {
  id: string;
  task_id?: string;
  status: string;
  created_at: string;
  finished_at?: string | null;
}
export interface UfaView {
  disposition: "NOT_CONNECTED";
  evidence: UfaEvidence;
  live: false;
  connection: UfaConnection;
  reason?: string;
  observedAt?: string;
  tasks?: UfaTask[];
  runs?: UfaRun[];
  task?: UfaTask;
  events?: UfaEventMeta[];
  bundle?: UfaBundleMeta | { available: false; reason: string };
  run?: UfaRun;
}

export interface UfaBridgeConfig {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  allowedOwner?: string;
  timeoutMs: number;
  maxBytes: number;
}

export class UfaError extends Error {
  constructor(
    readonly code:
      | "disabled"
      | "not_configured"
      | "invalid_input"
      | "invalid_response"
      | "refused"
      | "not_found"
      | "http_error"
      | "unavailable",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UfaError";
  }
}

/** True only for the observer GET allowlist. Query strings are not part of the path. */
export function isPermittedUfaRequest(method: string, pathname: string): boolean {
  if (method !== "GET") return false;
  if (!pathname.startsWith("/") || /[?#\\%]|\.\./.test(pathname)) return false;
  if (pathname === "/api/openmuse/tasks" || pathname === "/api/openmuse/runs") return true;
  const task = pathname.match(
    /^\/api\/openmuse\/tasks\/([a-z][a-z0-9]{0,15}_[0-9a-f]{12,16})(?:\/(events|evidence))?$/,
  );
  if (task) return true;
  const run = pathname.match(/^\/api\/openmuse\/runs\/([a-z][a-z0-9]{0,15}_[0-9a-f]{12,16})$/);
  return Boolean(run);
}

export function readUfaBridgeConfig(env: NodeJS.ProcessEnv = process.env): UfaBridgeConfig {
  const timeoutMs = 5_000;
  const maxBytes = 512_000;
  if (env.UFA_BRIDGE_ENABLED !== "true") return { enabled: false, timeoutMs, maxBytes };
  const baseUrl = normalizeBaseUrl(requiredSecret("UFA_BASE_URL", env.UFA_BASE_URL));
  const apiKey = requiredSecret("UFA_API_KEY", env.UFA_API_KEY);
  if (apiKey.length < 16 || apiKey.length > 256 || /[\r\n\s]/.test(apiKey))
    throw new Error("UFA_API_KEY must be a single token of 16 to 256 characters");
  const allowedOwner = requiredSecret("UFA_BRIDGE_ALLOWED_OWNER", env.UFA_BRIDGE_ALLOWED_OWNER);
  if (!/^[\w.-]{1,128}$/.test(allowedOwner))
    throw new Error("UFA_BRIDGE_ALLOWED_OWNER must be a single owner identifier");
  return { enabled: true, baseUrl, apiKey, allowedOwner, timeoutMs, maxBytes };
}

function requiredSecret(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required when UFA_BRIDGE_ENABLED=true`);
  return trimmed;
}

/** Fixed origin only. HTTP is limited to loopback so a remote bridge cannot be cleartext. */
export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("UFA_BASE_URL must be an absolute http(s) origin");
  }
  if (url.username || url.password) throw new Error("UFA_BASE_URL must not contain credentials");
  if (url.search || url.hash || (url.pathname !== "/" && url.pathname !== ""))
    throw new Error("UFA_BASE_URL must be an origin with no path, query, or fragment");
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("UFA_BASE_URL must use http or https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol === "http:" && !LOOPBACK.has(host) && !LOOPBACK.has(url.hostname))
    throw new Error("UFA_BASE_URL must use https except for loopback");
  return url.origin;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new UfaError("invalid_response", "UFA response did not match the read contract");
  return result.data;
}

function redact(value: string, secret: string | undefined): string {
  if (!secret || secret.length < 8) return value;
  return value.split(secret).join("[redacted]");
}

function assertNoSecret(value: unknown, secret: string | undefined) {
  if (!secret || secret.length < 8) return;
  if (JSON.stringify(value).includes(secret))
    throw new UfaError("invalid_response", "UFA response did not match the read contract");
}

/**
 * OpenMuse-owned read-only UFA client. Disabled unless explicitly configured.
 * It never follows redirects and never calls a path outside the GET allowlist.
 */
export class UfaAdapter {
  readonly evidence: UfaEvidence;
  readonly #enabled: boolean;
  readonly #baseUrl?: string;
  readonly #apiKey?: string;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;
  readonly #fetch: typeof fetch;

  constructor(
    options: {
      enabled?: boolean;
      baseUrl?: string;
      apiKey?: string;
      timeoutMs?: number;
      maxBytes?: number;
      evidence?: UfaEvidence;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.#enabled = options.enabled === true;
    this.#baseUrl = options.baseUrl;
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#maxBytes = options.maxBytes ?? 512_000;
    this.evidence = options.evidence ?? "unverified";
    this.#fetch = options.fetch ?? fetch;
  }

  get configured(): boolean {
    return this.#enabled && Boolean(this.#baseUrl && this.#apiKey);
  }

  idleView(): UfaView {
    if (!this.#enabled) {
      return this.#view("disabled", "UFA bridge is disabled");
    }
    return this.#view("unavailable", "UFA bridge is not configured");
  }

  failureView(error: unknown): UfaView {
    const reason = error instanceof UfaError ? error.message : "UFA is unavailable";
    return this.#view("unavailable", reason);
  }

  async overview(): Promise<UfaView> {
    if (!this.configured) return this.idleView();
    const [tasksBody, runsBody] = await Promise.all([
      this.#get("/api/openmuse/tasks", { limit: "20" }),
      this.#get("/api/openmuse/runs", { limit: "20" }),
    ]);
    const tasks = parse(
      z.object({ tasks: z.array(taskSchema).max(50) }).strict(),
      tasksBody,
    ).tasks.map((task) => this.#task(task));
    const runs = parse(z.object({ runs: z.array(runSchema).max(50) }).strict(), runsBody).runs.map(
      (run) => this.#run(run),
    );
    const view: UfaView = {
      ...this.#view("observed"),
      observedAt: new Date().toISOString(),
      tasks,
      runs,
    };
    assertNoSecret(view, this.#apiKey);
    return view;
  }

  async task(id: string): Promise<UfaView> {
    const taskId = this.#id(id);
    if (!this.configured) return this.idleView();
    const task = this.#task(parse(taskSchema, await this.#get(`/api/openmuse/tasks/${taskId}`)));
    const events = parse(
      z.object({ events: z.array(eventSchema).max(100) }).strict(),
      await this.#get(`/api/openmuse/tasks/${taskId}/events`, { limit: "50" }),
    ).events.map((event) => this.#event(event, taskId));
    let bundle: UfaView["bundle"];
    try {
      bundle = this.#evidence(
        parse(evidenceSchema, await this.#get(`/api/openmuse/tasks/${taskId}/evidence`)),
        taskId,
      );
    } catch (error) {
      if (error instanceof UfaError && (error.code === "not_found" || error.status === 501)) {
        bundle = { available: false, reason: "UFA did not return evidence metadata" };
      } else {
        throw error;
      }
    }
    const view: UfaView = {
      ...this.#view("observed"),
      observedAt: new Date().toISOString(),
      task,
      events,
      bundle,
    };
    assertNoSecret(view, this.#apiKey);
    return view;
  }

  async run(id: string): Promise<UfaView> {
    const runId = this.#id(id);
    if (!this.configured) return this.idleView();
    const run = this.#run(parse(runSchema, await this.#get(`/api/openmuse/runs/${runId}`)));
    if (run.id !== runId)
      throw new UfaError("invalid_response", "UFA response did not match the read contract");
    const view: UfaView = {
      ...this.#view("observed"),
      observedAt: new Date().toISOString(),
      run,
    };
    assertNoSecret(view, this.#apiKey);
    return view;
  }

  #view(connection: UfaConnection, reason?: string): UfaView {
    return {
      disposition: "NOT_CONNECTED",
      evidence: this.evidence,
      live: false,
      connection,
      ...(reason ? { reason } : {}),
    };
  }

  #id(id: string): string {
    if (!ID_PATTERN.test(id)) throw new UfaError("invalid_input", "UFA identifier is not allowed");
    return id;
  }

  #task(task: z.infer<typeof taskSchema>): UfaTask {
    return {
      id: task.id,
      state: redact(task.state, this.#apiKey),
      created_at: task.created_at,
      updated_at: task.updated_at,
    };
  }

  #event(event: z.infer<typeof eventSchema>, taskId: string): UfaEventMeta {
    if (event.task_id !== taskId)
      throw new UfaError("invalid_response", "UFA response did not match the read contract");
    return {
      id: event.id,
      type: redact(event.type, this.#apiKey),
      task_id: event.task_id,
      created_at: event.created_at,
      payloadOmitted: true,
    };
  }

  #evidence(evidence: z.infer<typeof evidenceSchema>, taskId: string): UfaBundleMeta {
    if (evidence.task_id !== taskId)
      throw new UfaError("invalid_response", "UFA response did not match the read contract");
    return {
      available: true,
      task_id: evidence.task_id,
      signaturePresent: false,
      signatureVerified: false,
      eventCount: evidence.event_count,
      artifactCount: evidence.artifact_count,
      verificationCount: evidence.verification_count,
      approvalCount: evidence.approval_count,
    };
  }

  #run(run: z.infer<typeof runSchema>): UfaRun {
    return {
      id: run.id,
      ...(run.task_id ? { task_id: run.task_id } : {}),
      status: redact(run.status, this.#apiKey),
      created_at: run.created_at,
      ...(run.finished_at !== undefined ? { finished_at: run.finished_at } : {}),
    };
  }

  #endpoint(pathname: string, query?: Record<string, string>): URL {
    if (!this.#baseUrl) throw new UfaError("not_configured", "UFA bridge is not configured");
    if (!isPermittedUfaRequest("GET", pathname))
      throw new UfaError("invalid_input", "UFA path is not allowed");
    const url = new URL(pathname, this.#baseUrl);
    if (url.origin !== this.#baseUrl || url.pathname !== pathname)
      throw new UfaError("invalid_input", "UFA path is not allowed");
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (!/^[a-z]{1,16}$/.test(key) || !/^[0-9]{1,3}$/.test(value))
          throw new UfaError("invalid_input", "UFA path is not allowed");
        url.searchParams.set(key, value);
      }
    }
    if (url.searchParams.has("redact"))
      throw new UfaError("invalid_input", "UFA path is not allowed");
    return url;
  }

  async #get(pathname: string, query?: Record<string, string>): Promise<unknown> {
    const url = this.#endpoint(pathname, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.#apiKey}`,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted)
        throw new UfaError("unavailable", "UFA did not respond in time");
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
        throw new UfaError("unavailable", "UFA did not respond in time");
      throw new UfaError("unavailable", "UFA is unavailable");
    } finally {
      clearTimeout(timer);
    }
    if ((response.status >= 300 && response.status < 400) || response.type === "opaqueredirect")
      throw new UfaError(
        "refused",
        "UFA redirected the request; redirects are not followed",
        response.status,
      );
    const body = await readBounded(response, this.#maxBytes);
    if (response.status === 401 || response.status === 403)
      throw new UfaError("refused", "UFA refused the request", response.status);
    if (response.status === 404)
      throw new UfaError("not_found", "UFA did not find that record", 404);
    if (response.status !== 200)
      throw new UfaError("http_error", "UFA returned an unexpected status", response.status);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json"))
      throw new UfaError(
        "invalid_response",
        "UFA response did not match the read contract",
        response.status,
      );
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new UfaError("invalid_response", "UFA response was not valid JSON", response.status);
    }
  }
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new UfaError("invalid_response", "UFA response exceeded the size limit", response.status);
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UfaError(
        "invalid_response",
        "UFA response exceeded the size limit",
        response.status,
      );
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}
