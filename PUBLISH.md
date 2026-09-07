# Publish Casper Tools to npm

Casper Tools is listed on the official MCP Registry and Glama but its npm package
has **never been published** — `npm view casper-tools` returns 404. npm is the
#1 package-manager directory agents and humans search, so this is the highest-impact
listing-visibility gap left in T-31 (WS2).

This file is the fire-ready kit. Whoever holds the npm credentials runs the two
commands below; nothing else is needed.

## Status

- Package name `casper-tools` — **free** (verified 2026-09-07).
- Scoped alt `@magiautonomous/casper-tools` — **free** (same day).
- `package.json` is publish-ready: `name`, `version` 1.4.0, 19-tool description,
  18 keywords, `license: MIT`, `repository`, `bugs`, `homepage`, lean `files`
  whitelist, `engines >= 18`.
- Dry-run verified: tarball = 36.2 kB, 11 files (runtime + docs, no tunnel/registry
  config noise).

## One-time scope/login (holder has creds)

```bash
npm login                  # already-linked account in the `casper-tools` scope
```

## Publish (every release)

```bash
npm pack --dry-run         # eyeball tarball contents
npm publish                # default = public, since no private:true
```

For the scoped name (if the unscoped one is ever taken): `npm publish --access public`.

## Verify after publish

```bash
npm view casper-tools version license      # 1.4.0, MIT
npm view casper-tools dist-tags            # latest
npm view casper-tools repository.url
npm view casper-tools keywords
```

Smoke test the installed artifact (true consumer path):

```bash
tmp=$(mktemp -d) && cd "$tmp"
npm pack casper-tools                       # grab the real published tarball
npm install ./casper-tools-1.4.0.tgz        # no devDeps on install
node -e "const s=require('casper-tools'); console.log(Object.keys(s))"   # expect tool handlers
```

## Rough edges to know

- There is **no `bin`** — `npm start` (node server.js) is the run path, matching
  README's "Run it". A future `npx casper-tools` one-liner needs a `bin` entry +
  Casper's sign-off; until then the MCP client config snippet in README is the
  setup story.
- `npm view casper-tools` must return **404 for nobody** after this. If an
  unrelated project ever grabs the name, fall back to `@magiautonomous/casper-tools`
  (also free) and update the README install lines.

## Refresh the official MCP Registry card (separate from npm)

The MCP Registry card (`io.github.magiautonomous/casper-tools`) is a different
surface than the npm package and can drift from `server.json`. Verified drift
on 2026-09-07: card was at **v1.2.4 / 14-tool description** while `server.json`
was v1.4.0 / 19 tools. Now back in sync (Melchior republished via the API flow
below, 2026-09-07 00:59Z).

### Automated path (primary)

`.github/workflows/publish-mcp.yml` publishes the card on any `v*` tag push
(`mcp-publisher login github-oidc` + `mcp-publisher publish`). Tagging releases
keeps every later bump automatic — no hand edits.

### Manual immediate-sync path (what Melchior ran)

Same outcome without waiting for a tag; needs only the org GitHub token already
in the repo remotes. Run from anywhere with network + `node`:

```bash
TOK=<ORG_GITHUB_TOKEN>   # magiautonomous PAT already in the git pushurl
RT=$(curl -s -X POST -H 'Content-Type: application/json' \
     --data "{\"github_token\":\"$TOK\"}" \
     https://registry.modelcontextprotocol.io/v0/auth/github-at \
  | node -pe 'const j=JSON.parse(require("fs").readFileSync(0));j.registry_token||""')
curl -s -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $RT" \
  --data @server.json \
  https://registry.modelcontextprotocol.io/v0/publish
```

Notes from the live run:

- Endpoint shapes (from the registry OpenAPI at `/openapi.json`): the fetch URL
  is `GET /v0.1/servers/io.github.magiautonomous%2Fcasper-tools/versions/latest`
  (the `/` in the server name must be URL-encoded). Publish is
  `POST /v0/publish` with the full `server.json` card; description is capped at
  **100 chars** (drop-in server.json description is too long — trim to a short
  "19 utilities: …" list). `POST /v0/validate` proves the card before publish;
  both returned `valid:true` / `200`.
- The card body does **not** carry the `tools` array (tool list lives in
  `tools.js`; directories like Glama ingest tool tables from a live probe).

## Who does it

- npm credentials are human-owned → **Taner/Casper**. Melchior has no npm auth.
- Once published, Melchior owns the *aftermath*: link npm in README's Registry
  section, add the install line to the mcp.so/Smithery/PulseMCP submission copy,
  and verify the MCP-registry auto-crawl picks up the npm metadata.
- MCP Registry card refreshes: automated via `v*` tags (Casper build-side);
  Melchior runs the manual sync above for same-session drift (as done
  2026-09-07).