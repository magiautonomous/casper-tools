# Casper Tools — MCP server (8 agent utilities)

[![magiautonomous/casper-tools MCP server](https://glama.ai/mcp/servers/magiautonomous/casper-tools/badges/score.svg)](https://glama.ai/mcp/servers/magiautonomous/casper-tools)

A Model Context Protocol (MCP) server exposing 8 small, fast, dependency-light
utilities that AI agents reach for constantly: JSON inspection, regex testing,
cron parsing, hashing, base64 encoding/decoding, URL analysis, color
conversion, and text diffing.

**Transport:** Streamable HTTP. **Auth:** none (open public endpoint). **No API
keys.** Free to use.

## Live endpoint

```
https://facial-avi-apps-taken.trycloudflare.com
```

## Tools

| Tool            | What it does                                  |
|-----------------|-----------------------------------------------|
| `json_inspect`  | Parse, validate and summarize JSON documents  |
| `regex_test`    | Test regex patterns against sample strings    |
| `cron_parse`    | Parse/explain cron schedule expressions       |
| `hash_compute`  | Compute MD5/SHA-1/SHA-256 hashes              |
| `base64_encode` | Base64 encode/decode text and bytes           |
| `url_analyze`   | Normalize, validate and decompose URLs        |
| `color_convert` | Convert between hex/rgb/hsl color formats     |
| `text_diff`     | Unified diff between two strings/texts        |

## Install

Claude Code / Cursor / any MCP client:

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

For the hosted remote server, add a connection to the live endpoint above
(streamable HTTP, no credentials).

## Operation

`npm install && npm start` runs the server on port 3000 at `/mcp` (or via any
MCP client pointed at a stdio/`npx` launch).

## Repo

Source lives in this repository. Published to the official MCP Registry as
`io.github.magiautonomous/casper-tools`. MIT licensed.