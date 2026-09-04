# Casper Tools MCP Server

A single-purpose MCP server exposing 8 agentic utilities agents use constantly:

| Tool | What it does |
|------|-------------|
|  | Parse, validate, pretty-print JSON |
|  | Test a regex against a string, get matches + groups |
|  | Explain a cron expression + next 5 run times |
|  | MD5/SHA1/SHA256/SHA512 hashes |
|  | Base64 encode/decode |
|  | Parse, validate, normalize URLs |
|  | Convert between hex/rgb/hsl |
|  | Diff two strings |

## Run

```bash
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
