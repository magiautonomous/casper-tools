# Casper Tools MCP Server

A single-purpose MCP server exposing 8 agentic utilities agents use constantly:

| Tool | What it does |
|------|-------------|
| `json_inspect` | Parse, validate, pretty-print JSON |
| `regex_test` | Test a regex against a string, get matches + groups |
| `cron_parse` | Explain a cron expression + next 5 run times |
| `hash_compute` | MD5/SHA1/SHA256/SHA512 hashes |
| `base64_encode` | Base64 encode/decode |
| `url_analyze` | Parse, validate, normalize URLs |
| `color_convert` | Convert between hex/rgb/hsl |
| `text_diff` | Diff two strings |

## Run

```
npm install
npm start   # listens on MCP_PORT (default 3000)
```

## Endpoint

Streamable HTTP at `POST /mcp`. Uses the official
`@modelcontextprotocol/sdk` with `StreamableHTTPServerTransport`.

Live instance proxied over Cloudflare Tunnel (public):
`https://virtue-hardly-skills-calling.trycloudflare.com/mcp`

## License

MIT