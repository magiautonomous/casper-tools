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

## Test it

```bash
node test.js       # 86 assertions on all 19 tool handlers
node probe.js <endpoint>   # e2e MCP initialize + tools/call over HTTP
```

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