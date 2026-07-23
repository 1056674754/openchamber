# Subscriptions Module Documentation

## Purpose
This module exposes a read-only, instance-scoped view of provider authentication, quota linkage, config attribution, egress mode, and environment conflicts.

## Entrypoints and structure
- `packages/web/server/lib/subscriptions/auth-adapter.js`: reads provider auth state from OpenCode HTTP and falls back to legacy `auth.json` reads when OpenCode is unavailable.
- `packages/web/server/lib/subscriptions/conflicts.js`: detects environment variables that may override non-environment credentials.
- `packages/web/server/lib/subscriptions/aggregate.js`: merges provider, auth, quota, config, and conflict data into the public payload.
- `packages/web/server/lib/subscriptions/routes.js`: registers `GET /api/subscriptions`.

## Response contract
`GET /api/subscriptions` returns:

```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "auth": {
        "configured": true,
        "source": "api",
        "envVars": ["ANTHROPIC_API_KEY"],
        "type": "api"
      },
      "quota": { "providerId": "claude", "configured": true },
      "config": { "user": false, "project": true, "custom": false },
      "egress": { "mode": "direct" },
      "conflicts": []
    }
  ],
  "degraded": false,
  "fetchedAt": 1784629500000
}
```

When OpenCode cannot provide the provider snapshot, the route returns legacy provider auth entries as partial data and sets `degraded: true`. Fetch failure is never represented as a successful empty OpenCode snapshot.

## Security and ownership
- Public output is constructed from an allowlist of fields. Provider keys, API keys, auth headers, and upstream option objects are never returned.
- The route accepts the same explicit directory header/query context as provider source routes. Project config attribution uses that resolved directory; it does not fall back to a global active project.
- This module performs no config writes and does not change quota module behavior.
