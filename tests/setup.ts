import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";

// Unit/API fixtures must never emit production SDK telemetry.
// Telemetry tests exercise enabled behavior in isolated child processes.
process.env.DO_NOT_TRACK = "1";
process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";

// The sandbox preview host probes every listening TCP port with
// `User-Agent: grok-preview-probe` and `GET /`. This importer is used only by
// `pnpm test`. Dropping that user agent here keeps fixture servers from
// treating the probe as an application call. Production servers do not load
// this file, and any other request — including a real `GET /` — is unchanged.
const PREVIEW_PROBE_UA = "grok-preview-probe";
const originalEmit = http.Server.prototype.emit as (
  this: http.Server,
  event: string | symbol,
  ...args: unknown[]
) => boolean;
http.Server.prototype.emit = function (
  this: http.Server,
  event: string | symbol,
  ...args: unknown[]
): boolean {
  if (event === "request") {
    const request = args[0] as IncomingMessage | undefined;
    const response = args[1] as ServerResponse | undefined;
    const userAgent = request?.headers["user-agent"];
    if (typeof userAgent === "string" && userAgent.includes(PREVIEW_PROBE_UA)) {
      if (response && !response.writableEnded && !response.headersSent) {
        response.writeHead(404);
        response.end();
      }
      return true;
    }
  }
  return originalEmit.call(this, event, ...args);
};
