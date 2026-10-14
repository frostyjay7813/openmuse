# UFA read-only bridge

**Status: NOT CONNECTED. NOT ACCEPTED. NOT PRODUCTION.** The adapter is disabled unless `UFA_BRIDGE_ENABLED=true`. Every view keeps `disposition: "NOT_CONNECTED"`, `live: false`, and `evidence: "unverified"`. `signatureVerified` is always false. Fixture tests, green CI, and a successful loopback HTTP read are not formal acceptance and do not change UFA certification.

## Revisions

| What | Revision |
|---|---|
| OpenMuse base inspected | `CopilotKit/openmuse@1ac68f3909f2478ab6280883f1ab5ea65eb5719d` |
| Adapter implementation | `frostyjay7813/openmuse@c231d87e64de5a065a188095f644779d1e736eec` |
| OpenMuse documentation follow-up | `a24d50b7a05cae0fb51de0e336f5efa345070d26` (docs only) |
| UFA parser shapes | `028b4721df4f71c1ee0c6c0db4a929ce09227e95` (run IDs are 12 hex characters; open runs may have empty `finished_at`) |
| UFA authorization implementation | `db71c07aea553141f8d4c752ba0c5db4dc4a798f` |
| UFA spike tip reviewed | `83ad7328cc4d5da10961707f7bb233541a7e49eb`. Draft [PR #7](https://github.com/frostyjay7813/Unified-Frontier-Agent/pull/7) stays on that commit and is unmerged. |
| Observer projection | `frostyjay7813/Unified-Frontier-Agent@03c543230e4e983cf81c52cb1113164dbd2c47aa` on `spike/openmuse-least-privilege`, branched from `83ad732`. `GET /api/openmuse/*` with scope `openmuse:read`. Not merged. |
| OpenMuse pull request | [Draft PR #1](https://github.com/frostyjay7813/openmuse/pull/1) stays on `feat/ufa-readonly-bridge` and is unmerged. This adapter change is a separate branch. |

UFA remains authoritative for task state, authorization, and evidence. The bridge is a presentation adapter; it does not create tasks, transition them, approve actions, schedule work, or open a browser or terminal.

## Authorization contract

The UFA spike rejects omitted, `null`, empty, and invalid scope requests with HTTP 400 before storing a key or writing a `keys.create` audit entry. These requests never default to `["*"]`. Explicit `["*"]` is an operator opt-in and must be the only requested scope. Unmapped routes and unsupported methods fail closed for bearer keys; read-only keys cannot mint/revoke keys, write, access runtime controls, or request unredacted event payloads.

This adapter calls only `GET /api/openmuse/*` and expects scope `openmuse:read`. It does not call `/api/tasks`, `/api/runs`, `/api/tasks/{id}/bundle`, or `/api/artifacts`. Responses are parsed with strict schemas. A title, goal, result, step, payload, signature, or any other undeclared field fails the read contract and is not copied into the OpenMuse view. `signatureVerified` stays false. `signature_present` is accepted only as `false`.

`tasks:read` and `runs:read` do not grant the observer routes. Those console routes still return titles, goals, results, steps, and redacted event payloads. That is why this adapter no longer uses them.

## Transport is not acceptance

An earlier single-owner loopback check used `tasks:read` + `runs:read` and `GET /api/tasks` plus `GET /api/runs`. That was transport only. It is not evidence for this observer contract. No new live round trip has been accepted. Fixture tests in this tree are not a connection.

This does not establish:

- independent cryptographic verification of a signature or evidence bundle;
- a tenant partition (UFA has no tenant column; a tenant selector is refused, and two observer keys still see one store);
- a multi-user, non-loopback, or TLS deployment review;
- formal integration acceptance or any change in UFA certification.

## Read-only view

| View | UFA request | Shown |
|---|---|---|
| Task list/detail | `GET /api/openmuse/tasks`, `GET /api/openmuse/tasks/{id}` | Opaque id, source state, timestamps. No title. |
| Event metadata | `GET /api/openmuse/tasks/{id}/events` | Id, classification `type`, task id, timestamp. No payload. |
| Evidence counts | `GET /api/openmuse/tasks/{id}/evidence` | Counts only. Signature is absent and not verified. No manifest hash and no artifact bytes. |
| Runs | `GET /api/openmuse/runs`, `GET /api/openmuse/runs/{id}` | Id, task id, status, timestamps. |

Other methods and paths are rejected before a request is sent. Redirects are not followed. The response body is size-capped.

## Server-only configuration

Keep the bridge disabled unless an intentional local single-owner test is being performed:

```bash
UFA_BRIDGE_ENABLED=true
UFA_BASE_URL=http://127.0.0.1:8000
UFA_API_KEY=replace-with-the-one-time-key
UFA_BRIDGE_ALLOWED_OWNER=local-user
```

The example is for loopback testing only. The key is read by `apps/server`, never by the mobile client. Do not place it in `EXPO_PUBLIC_*`, mobile storage, prompts, or logs. Remote origins must use HTTPS; HTTP is accepted only for loopback. The process must refuse to start if the bridge is enabled without a base URL, key, and allowed owner.

Create the UFA key only after operator authentication is configured. Request exactly `["openmuse:read"]`. Do not request `tasks:read`, `runs:read`, `artifacts:read`, or `["*"]`.

## Acceptance gate

Before acceptance, separately review field-level least privilege, signature/evidence verification, multi-user authorization, and non-loopback/TLS deployment. Run the documented CI checks against the exact candidate commits and review the resulting evidence.

Until those gates are explicitly accepted, keep both PRs draft and unmerged, the bridge disabled, `NOT_CONNECTED`, `live: false`, evidence unverified, and UFA certification unchanged.
