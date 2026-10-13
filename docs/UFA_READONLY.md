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
| UFA spike tip reviewed | `83ad7328cc4d5da10961707f7bb233541a7e49eb`; API implementation blob `50f12881f68b437610b5d0bd5de3916832852099` is unchanged |
| UFA pull request | [Draft PR #7](https://github.com/frostyjay7813/Unified-Frontier-Agent/pull/7), unmerged |
| OpenMuse pull request | [Draft PR #1](https://github.com/frostyjay7813/openmuse/pull/1), unmerged |

UFA remains authoritative for task state, authorization, and evidence. The bridge is a presentation adapter; it does not create tasks, transition them, approve actions, schedule work, or open a browser or terminal.

## Authorization contract

The UFA spike rejects omitted, `null`, empty, and invalid scope requests with HTTP 400 before storing a key or writing a `keys.create` audit entry. These requests never default to `["*"]`. Explicit `["*"]` is an operator opt-in and must be the only requested scope. Unmapped routes and unsupported methods fail closed for bearer keys; read-only keys cannot mint/revoke keys, write, access runtime controls, or request unredacted event payloads.

The OpenMuse adapter requests only its explicit read allowlist, keeps the bearer key server-side, rejects redirects, applies response size limits, and drops sensitive fields before returning its view. Do not request `artifacts:read`; artifact download is not on the allowlist.

## Transport is not acceptance

A single-owner loopback check with UFA authentication enabled and an explicit `tasks:read` + `runs:read` key returned HTTP 200 for `GET /api/tasks` and `GET /api/runs`. OpenMuse then reported `connection: "observed"` while retaining `NOT_CONNECTED`, `live: false`, and `evidence: "unverified"`. The key was not present in the overview JSON. The temporary test keys were revoked and secret files removed after the check.

This establishes transport and the tested key-creation behavior only. It does not establish:

- independent cryptographic verification of a signature or evidence bundle;
- field-level least privilege at the UFA API boundary (`runs:read` can still return goals, results, and step payloads, which the adapter drops);
- source-level payload omission (UFA event reads return redacted payloads, which the adapter drops);
- a multi-user, non-loopback, or TLS deployment review;
- formal integration acceptance or any change in UFA certification.

## Read-only view

| View | UFA request | Adapter behavior |
|---|---|---|
| Task list/detail | `GET /api/tasks`, `GET /api/tasks/{id}` | Shows source state and timestamps |
| Event metadata | `GET /api/tasks/{id}/events` | Never requests unredacted data; drops payloads |
| Evidence metadata | `GET /api/tasks/{id}/bundle` | Shows counts, manifest hash, artifact metadata, and signature presence; does not verify the signature |
| Runs | `GET /api/runs`, `GET /api/runs/{id}` | Shows status/timestamps; drops goals, results, and step payloads |

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

Create the UFA key only after operator authentication is configured. Request exactly `["tasks:read", "runs:read"]` for this first phase. Do not request wildcard or artifact scopes.

## Acceptance gate

Before acceptance, separately review field-level least privilege, signature/evidence verification, multi-user authorization, and non-loopback/TLS deployment. Run the documented CI checks against the exact candidate commits and review the resulting evidence.

Until those gates are explicitly accepted, keep both PRs draft and unmerged, the bridge disabled, `NOT_CONNECTED`, `live: false`, evidence unverified, and UFA certification unchanged.
