# Casper Tools MCP Server

> 19 zero-setup MCP utilities for AI agents — JSON, regex, cron, hashing,
> semver, JWT, CSV, YAML, Markdown and more. No API keys, no auth, no install weight.

A Model Context Protocol (MCP) server exposing **19** small, dependency-light
utilities that AI agents reach for constantly. Streamable HTTP transport, drop it
into any MCP client in seconds. No auth, no API keys, free.

**Endpoint:** `POST /mcp` (also accepted at the bare host root) on port 3000.

## Tools

| Tool               | What it does                                       |
|--------------------|----------------------------------------------------|
| `json_inspect`     | Parse / validate / pretty-print JSON               |
| `regex_test`       | Test regex against text, list matches + groups     |
| `cron_parse`       | Explain a cron expression + next 5 run times       |
| `hash_compute`     | MD5 / SHA-1 / SHA-256 / SHA-512 digest             |
| `base64_encode`    | Base64 encode / decode                             |
| `url_analyze`      | Decompose + validate a URL                         |
| `color_convert`    | Convert hex / rgb / hsl / named colors             |
| `text_diff`        | Line diff between two texts                        |
| `csv_parse`        | Parse CSV/TSV into rows + JSON preview             |
| `jwt_decode`       | Decode + verify HMAC-signed JWTs                   |
| `markdown_to_html` | Render Markdown to HTML (raw HTML escaped)         |
| `uuid_mint`        | Generate v4 UUIDs / random URL-safe tokens         |
| `time_convert`     | Epoch / ISO / relative / timezone conversions      |
| `password_strength`| Score passwords: score, entropy, crack time, tips  |
| `semver_compare`   | Compare versions with correct SemVer precedence    |
| `semver_satisfies` | Check a version against an npm-style range         |
| `semver_bump`      | Increment major/minor/patch/prerelease             |
| `semver_max`       | Pick the best satisfying version for an upgrade    |
| `yaml_parse`       | Parse YAML (maps/lists/flow, multi-doc) into JSON  |

## Why Casper Tools

- **Zero setup** — one `POST /mcp` endpoint, no auth, no API keys, no cloud
  account. Point any MCP client at it and go.
- **Dependency-light** — pure, small handlers tuned for the utilities agents
  reach for dozens of times a day.
- **Drop-in** — works with Claude Desktop, Cursor, and any MCP-capable agent
  over Streamable HTTP.
- **Batteries included** — semver, JWT, CSV, YAML, Markdown, color, UUID and
  JSON tooling covers the boring-but-common cases so your agent doesn't reinvent
  them.

## Run it

```bash
npm install
npm start          # port 3000, /mcp
```

Once the npm package is published (`npm i casper-tools`), this is the same
install — see `PUBLISH.md` for the publish kit.

## Connect an MCP client

Point any MCP-capable agent (Claude Desktop, Cursor, Claude Code) at the endpoint:

```json
{
  "mcpServers": {
    "casper-tools": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Or skip the local run and use the public endpoint — the current tunnel URL is in
`server.json` and on the official MCP Registry entry below.

## Test it

```bash
node test.js       # 86 assertions on all 19 tool handlers
node probe.js <endpoint>   # e2e MCP initialize + tools/call over HTTP
```

## Docs

- `DEMO.md` — 90-second live walkthrough: connect, pick a tool, raw Streamable
  HTTP `curl` call against the public endpoint, verified output.
- `PUBLISH.md` — npm publish kit: fire-ready commands + verification for
  getting the `casper-tools` package on the npm registry (T-31 WS2).
- **Feature story** — [Casper Tools on the official MCP Registry](
  https://magiautonomous.github.io/agentic-web-blog/posts/2026-09-05-casper-tools-mcp-registry.html)
  (Agentic Web Blog) — how these utilities ship on the official registry and
  why zero-setup MCP matters for the agentic web.

## Registry & directory presence

Where the server is listed and how to get it in more places:

- **Official MCP Registry** — `io.github.magiautonomous/casper-tools`,
  published under `https://registry.modelcontextprotocol.io` (search "casper
  tools"). Version **1.4.0 is the latest published entry** — re-verified live
  2026-09-07 (00:59Z publish; card had drifted to 1.2.4/14-tool desc, now in
  sync with `server.json`). Future bumps ride the `v*`-tag workflow
  (`.github/workflows/publish-mcp.yml`) or the manual one-command sync in
  `PUBLISH.md`.
- **Glama** — [glama.ai/mcp/servers/magiautonomous/casper-tools](
  https://glama.ai/mcp/servers/magiautonomous/casper-tools) (present; auto-syncs
  from the official registry). Verified 2026-09-07: endpoint is current, but the
  cached description/tool table still says 12 utilities — a registry publish
  (v1.4.0) just landed 00:59Z, so the cache should refresh on Glama's next
  crawl; claim the listing to force an early refresh.
- **mcprepository.com** — [mcprepository.com/magiautonomous/casper-tools](
  https://mcprepository.com/magiautonomous/casper-tools) (present but STALE,
  verified 2026-09-07): index shows 8 tools and a dead tunnel URL
  (`virtue-hardly-skills-calling`, offline). Their `POST /api/index` refresh
  returns `duplicate:true` and refuses to re-crawl, so update must go through
  the web submit form (human click) with the corrected copy below.
- **npm (not yet)** — package `casper-tools` v1.4.0 is publish-ready
  (`PUBLISH.md`); npm listing pending human npm credentials. Once live, the
  `npm i casper-tools` + `npm start` path above is the drop-in install.
- **mcp.directory / mcp.so / Smithery / PulseMCP / mcpservers.org** — not listed
  yet (verified 2026-09-07). They auto-pull from the official registry or accept
  a web-form submission.

### Directory update kit (current as of 2026-09-07)

Same fields for any submit/update form (Glama claim, mcprepository, mcp.so,
Smithery, PulseMCP):

```
Server name:  Casper Tools
Version:      1.4.0
GitHub URL:   https://github.com/magiautonomous/casper-tools
Description:  MCP server with 19 agentic utilities over Streamable HTTP —
              JSON inspect, regex test, cron parse, hash, base64, URL
              analysis, color convert, text diff, CSV parse, JWT decode,
              Markdown-to-HTML, UUID mint, time convert, password strength,
              semver (compare/satisfies/bump/max), YAML parse. No auth, no
              API keys, zero setup.
Tags:         mcp, developer-tools, utility, json, semver, yaml, jwt
Connection:   POST https://determines-product-administration-farmer.trycloudflare.com/mcp
Registry:     io.github.magiautonomous/casper-tools (official MCP Registry)
```

- Getting listed/updated is tracked in T-31 (WS2 listing visibility); submissions
  that need a human browser/account are handed to Taner/Casper to click.

## Analytics

Every tool call is appended to `logs/calls.jsonl` (timestamp, tool, caller IP)
so traffic can be measured. Tail it with:

```bash
tail -f logs/calls.jsonl
```

## Registry + tunnel wiring

- `server.json` — MCP registry manifest (version, tags, license, remotes).
- `tunnel-watch.sh` + `mcp-tunnel-watch.timer` — every 5 min, if the
  trycloudflare quick-tunnel hostname rotates, repoint the manifests in this
  repo and in `casper-tools` (deployed copy published to the official MCP
  Registry), and push a new patch tag so the GH Action republishes.
- Deployed copy: `github.com/magiautonomous/casper-tools` (registry entry
  `io.github.magiautonomous/casper-tools`).