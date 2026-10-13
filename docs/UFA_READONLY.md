# UFA read-only bridge

**Status: NOT CONNECTED. NOT ACCEPTED.** The adapter is disabled unless `UFA_BRIDGE_ENABLED=true`. Every view keeps `disposition: "NOT_CONNECTED"`, `live: false`, and `evidence: "unverified"`. `signatureVerified` is always false. Fixture tests, a green CI run, and a loopback HTTP read are not formal acceptance and do not change Unified Frontier Agent certification.

## Revisions

| What | Revision |
|---|---|
| OpenMuse base inspected | `CopilotKit/openmuse@1ac68f3909f2478ab6280883f1ab5ea65eb5719d` |
| This adapter | `frostyjay7813/openmuse@c231d87e64de5a065a188095f644779d1e736eec` on `feat/ufa-readonly-bridge` |
| UFA read shapes the parser accepts | `028b4721df4f71c1ee0c6c0db4a929ce09227e95` (12-hex run ids, empty `finished_at` while a run is open; task and event ids remain 16 hex). Those shapes are unchanged through the spike tip. |
| UFA authorization code | `db71c07aea553141f8d4c752ba0c5db4dc4a798f` (`backend/ufa/api.py` blob `50f12881f68b437610b5d0bd5de3916832852099`) |
| UFA spike tip | `ab09450dbb18f241125aa186239a08ae13e2ca3b`, then review note `83ad7328cc4d5da10961707f7bb233541a7e49eb` (docs only; `backend/ufa/api.py` blob still `50f12881f68b437610b5d0bd5de3916832852099`). Draft [PR #7](https://github.com/frostyjay7813/Unified-Frontier-Agent/pull/7) is not merged. |

OpenMuse remains the presentation surface. UFA remains authoritative for task state, authorization, and evidence. The bridge does not create tasks, transition them, approve actions, schedule work, or open a browser or terminal.

## Transport is not acceptance

A single-owner loopback check against the authorization code above returned HTTP 200 for `GET /api/tasks` and `GET /api/runs` with an explicit `tasks:read` + `runs:read` key. OpenMuse's overview then reported `connection: "observed"` while remaining `NOT_CONNECTED`, `live: false`, and `evidence: "unverified"`. The key was not present in that JSON. Omitted, null, and invalid scope creates returned 400 and stored nothing. That is successful transport. It is not:

- independent verification of a UFA signature or evidence bundle
- proof that `runs:read` is field-level least privilege (`goal`, `result`, and step payloads still leave UFA; this adapter drops them)
- proof that UFA event redaction is omission (UFA returns redacted payloads; this adapter drops them)
- a multi-user, non-loopback, or TLS deployment review
- a reason to merge either draft pull request or to raise UFA certification

## What the client may read

| View | UFA request | Notes |
|---|---|---|
| Task list and detail | `GET /api/tasks`, `GET /api/tasks/{id}` | Source `state`, `created_at`, and `updated_at` are shown unchanged. |
| Event metadata | `GET /api/tasks/{id}/events` | `redact` is never sent. Payloads are dropped before the response leaves OpenMuse. |
| Evidence metadata | `GET /api/tasks/{id}/bundle` | Counts, manifest hash, artifact ids/hashes, and whether a signature field was present. Signature verification is not claimed. |
| Runs | `GET /api/runs`, `GET /api/runs/{id}` | Status and timestamps only. Run results, goals, and step payloads are dropped. |

Any other method or path is rejected in the adapter before a request is sent. Redirects are not followed. The response body is size-capped. Artifact download is not on this allowlist; do not mint `artifacts:read` for this adapter.

## Server-only configuration

Leave the bridge off until a local single-owner test is intentional:

```bash
UFA_BRIDGE_ENABLED=true
UFA_BASE_URL=http://127.0.0.1:8000
UFA_API_KEY=replace-with-the-one-time-key
UFA_BRIDGE_ALLOWED_OWNER=local-user
```

`UFA_API_KEY` is read only by `apps/server`. Sample-mode sessions are owned by `local-user`; set `UFA_BRIDGE_ALLOWED_OWNER` to that value for a local test, or to the real owner when OpenMuse has more than one. Other signed-in owners receive 403 and no UFA request is made.

Create the key on UFA only after `UFA_USER` and `UFA_PASSWORD` are both set. Request `["tasks:read", "runs:read"]` and nothing else. Omitting `scopes`, or sending `null`, is rejected and must never be treated as `["*"]`. Do not request the administrative wildcard. Do not copy the key into `EXPO_PUBLIC_*`, mobile storage, prompts, or logs.

`UFA_BASE_URL` must be an origin. `http` is accepted only for `localhost`, `127.0.0.1`, and `::1`. Remote origins must be `https`. The process fails to start if the bridge is enabled without a base URL, key, and allowed owner.

## Local single-owner check

1. Run UFA's console on loopback with `UFA_USER` and `UFA_PASSWORD` set, from the authorization revision above. Do not expose it publicly.
2. Create a read-only key through the authenticated operator API. Store it only in the OpenMuse server environment.
3. Start OpenMuse with the four variables above and `WORKSPACE_MODE=sample`.
4. Sign in, open Apps, and choose Frontier Agent.
5. Expect source task states and timestamps, event types without payloads, and evidence counts. The screen stays labeled not connected. An error or disabled bridge shows UFA as unavailable and does not invent tasks.

A passing unit test that stubs `fetch` is a fixture. It is not evidence of a live round trip. A live round trip that stays `NOT_CONNECTED` is not formal acceptance.
