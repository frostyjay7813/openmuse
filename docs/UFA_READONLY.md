# UFA read-only bridge

**Status: NOT CONNECTED.** This adapter is disabled by default. Fixture tests are not a live integration, and nothing here changes Unified Frontier Agent certification.

## Revisions

- OpenMuse base: `CopilotKit/openmuse@1ac68f3909f2478ab6280883f1ab5ea65eb5719d`
- UFA candidate the client was written against: `frostyjay7813/Unified-Frontier-Agent@028b4721df4f71c1ee0c6c0db4a929ce09227e95` (draft PR #7, not merged)

OpenMuse remains the presentation surface. UFA remains authoritative for task state, authorization, and evidence. The bridge does not create tasks, transition them, approve actions, schedule work, or open a browser or terminal.

## What the client may read

| View | UFA request | Notes |
|---|---|---|
| Task list and detail | `GET /api/tasks`, `GET /api/tasks/{id}` | Source `state`, `created_at`, and `updated_at` are shown unchanged. |
| Event metadata | `GET /api/tasks/{id}/events` | `redact=false` is never sent. Payloads are dropped before the response leaves the server. |
| Evidence metadata | `GET /api/tasks/{id}/bundle` | Counts, manifest hash, artifact ids/hashes, and whether a signature field was present. Signature verification is not claimed. |
| Runs | `GET /api/runs`, `GET /api/runs/{id}` | Status and timestamps only. Run results and step payloads are dropped. |

Any other method or path is rejected in the adapter before a request is sent. Redirects are not followed. The response body is size-capped.

## Server-only configuration

Leave the bridge off until a local single-owner test is intentional:

```bash
UFA_BRIDGE_ENABLED=true
UFA_BASE_URL=http://127.0.0.1:8000
UFA_API_KEY=replace-with-the-one-time-key
UFA_BRIDGE_ALLOWED_OWNER=local-user
```

`UFA_API_KEY` is read only by `apps/server`. Sample-mode sessions are owned by `local-user`; set `UFA_BRIDGE_ALLOWED_OWNER` to that value for a local test, or to the real owner when OpenMuse has more than one. Other signed-in owners receive 403 and no UFA request is made.

Create the key on UFA with an explicit scope list (`tasks:read` and `runs:read`). Do not omit `scopes` (that still defaults to the legacy wildcard on the spike branch). Do not copy the key into `EXPO_PUBLIC_*`, mobile storage, prompts, or logs.

`UFA_BASE_URL` must be an origin. `http` is accepted only for `localhost`, `127.0.0.1`, and `::1`. Remote origins must be `https`. The process fails to start if the bridge is enabled without a base URL, key, and allowed owner.

## Local single-owner check

1. Run UFA's console on loopback with `UFA_USER` and `UFA_PASSWORD` set, from the candidate revision above. Do not expose it publicly.
2. Create a read-only key through the authenticated operator API. Store it only in the OpenMuse server environment.
3. Start OpenMuse with the four variables above and `WORKSPACE_MODE=sample`.
4. Sign in, open Apps, and choose Frontier Agent.
5. Expect source task states and timestamps, event types without payloads, and evidence counts. The screen stays labeled not connected. An error or disabled bridge shows UFA as unavailable and does not invent tasks.

A passing unit test that stubs `fetch` is a fixture. It is not evidence of a live round trip.
