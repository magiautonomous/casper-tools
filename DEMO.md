# Casper Tools — Live Demo Walkthrough

A 90-second walkthrough showing how to reach Casper Tools from any MCP-capable
agent (Claude Desktop, Cursor, Claude Code) and run a real tool call end to end.
No API keys, no auth, no local install required — everything runs against the
public live endpoint.

## 1. Connect

Point your MCP client at the live endpoint in its config:

```json
{
  "mcpServers": {
    "casper-tools": {
      "url": "https://determines-product-administration-farmer.trycloudflare.com"
    }
  }
}
```

Run it locally instead: `npm install && npm start`, then point the client at
`http://localhost:3000`.

## 2. Pick a tool

From an agent prompt, just ask. Any of the 16 tools:

- `json_inspect` — validate + pretty-print JSON
- `regex_test` — test a pattern, list matches + capture groups
- `cron_parse` — explain a cron expression + next 5 run times
- `semver_compare` / `semver_satisfies` / `semver_bump` / `semver_max` — SemVer math
- `uuid_mint` — v4 UUIDs / random URL-safe tokens
- `color_convert` — hex / rgb / hsl / named colors
- `jwt_decode` — decode + verify HMAC JWTs
- `text_diff` — line diff between two texts
- `csv_parse` — CSV/TSV into rows + JSON preview
- `markdown_to_html` — render Markdown (raw HTML escaped)
- `hash_compute` — MD5 / SHA-1 / SHA-256 / SHA-512
- `base64_encode`, `url_analyze`

## 3. Call a tool over HTTP

Here is a raw Streamable HTTP call against `POST /mcp`:

```bash
curl -s https://determines-product-administration-farmer.trycloudflare.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"semver_max","arguments":{"versions":"1.2.3, 1.10.0, 1.9.0","range":"^1.0.0"}}}'
```

## 4. What you get back

Casper Tools returns a clean, schema-validated result with no auth headers, no
API keys, no per-call billing. The same answer your agent sees:

```json
{
  "content": [{
    "type": "text",
    "text": "Versions checked: 1.2.3, 1.10.0, 1.9.0\nRange: ^1.0.0  →  expanded: >=1.0.0 AND <2.0.0\nMAX satisfying (best upgrade target): 1.10.0"
  }],
  "isError": false
}
```

## 5. Verify it yourself

```bash
node test.js        # 61 assertions across all 16 handlers
node probe.js <endpoint>  # e2e initialize + tools/call over HTTP
```

## Why run a demo on Casper Tools

- Zero setup — one `POST /mcp`, no keys, no cloud account.
- Fast — small, dependency-light handlers.
- Deterministic — pure utility output an agent can rely on.

Source: https://github.com/magiautonomous/casper-tools
Registry: `io.github.magiautonomous/casper-tools` on the official MCP Registry.
