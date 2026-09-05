# Casper Tools — MCP server (12 agent utilities)

[![magiautonomous/casper-tools MCP server](https://glama.ai/mcp/servers/magiautonomous/casper-tools/badges/score.svg)](https://glama.ai/mcp/servers/magiautonomous/casper-tools)

A Model Context Protocol (MCP) server exposing 12 small, fast, dependency-light
utilities that AI agents reach for constantly: JSON inspection, regex testing,
cron parsing, hashing, base64 encoding/decoding, URL analysis, color
conversion, text diffing, CSV parsing, JWT decode/verification, Markdown-to-HTML
rendering, and UUID/token minting.

**Transport:** Streamable HTTP. **Auth:** none (open public endpoint). **No API
keys.** Free to use.

## Live endpoint

```
https://determines-product-administration-farmer.trycloudflare.com
```

## Quick Example

Connect any MCP client and call tools with standard JSON-RPC over Streamable
HTTP. No auth, no keys, no setup.

**Initialize the session:**

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
```

**Call `json_inspect` on a sample payload:**

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"json_inspect","arguments":{"data":{"user":"alice","role":"admin"}}}}
```

Response includes `type`, `summary`, `keyCount`, `depth`, and `hasArrays`.

**Call `hash_compute` on a string:**

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"hash_compute","arguments":{"input":"hello world","algorithm":"sha-256"}}}
```

Response returns the hex-encoded digest plus algorithm + input length.

Full list of 12 tools, their input schemas, and live response examples are
available from the server itself via `tools/list` once connected.

## Tools

| Tool              | What it does                                    |
|-------------------|-------------------------------------------------|
| `json_inspect`    | Parse, validate and summarize JSON documents    |
| `regex_test`      | Test regex patterns against sample strings      |
| `cron_parse`      | Parse/explain cron schedule expressions         |
| `hash_compute`    | Compute MD5/SHA-1/SHA-256/SHA-512 hashes        |
| `base64_encode`   | Base64 encode/decode text and bytes             |
| `url_analyze`     | Normalize, validate and decompose URLs          |
| `color_convert`   | Convert between hex/rgb/hsl/named color formats |
| `text_diff`       | Line diff between two strings/texts             |
| `csv_parse`       | Parse CSV/TSV into rows, headers, JSON preview  |
| `jwt_decode`      | Decode + verify HMAC-signed JWTs                |
| `markdown_to_html`| Render Markdown to HTML (escaping raw HTML)     |
| `uuid_mint`       | Generate v4 UUIDs / random URL-safe tokens      |

## Install

Hosted mode — point any MCP client at the live endpoint above (streamable
HTTP, no credentials):

```json
{
  "mcpServers": {
    "casper-tools": {
      "url": "https://determines-product-administration-farmer.trycloudflare.com"
    }
  }
}
```

Local mode (Claude Code / Cursor / any MCP client):

```json
{
  "mcpServers": {
    "casper-tools": {
      "command": "npx",
      "args": ["-y", "casper-tools"]
    }
  }
}
```

## Operation

`npm install && npm start` runs the server on port 3000 at `/mcp` (also
accepted at the bare host root). Tools are registered from `tools.js` and each
call is appended to `logs/calls.jsonl` for analytics.

## Repo

Source lives in this repository. Published to the official MCP Registry as
`io.github.magiautonomous/casper-tools`. MIT licensed.
