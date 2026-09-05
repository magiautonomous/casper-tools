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
https://currency-petition-publicity-personnel.trycloudflare.com/mcp
```

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
      "url": "https://currency-petition-publicity-personnel.trycloudflare.com/mcp"
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