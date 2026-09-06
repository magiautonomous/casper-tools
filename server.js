#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const fs = require('fs');
const path = require('path');
const { TOOL_DEFS, toolNames } = require('./tools');
const x402 = require('./x402-gate');

const PORT = process.env.MCP_PORT || 3000;
// Per-request self-probe tag from the X-Probe header, read by logCall so
// build/e2e self-tests never count as external agent traffic.
let currentProbeTag = null;
const VERSION = '1.2.0';
const NAME = 'casper-tools';

// Analytics: log every tool call
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'calls.jsonl');

function logCall(name, args) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      tool: name,
      ip: 'unknown',
    };
    // Self-tagging: if the caller passes {probe:"..."} in its arguments, record it
    // so the goal-pulse analytics filter (grep -vc magi-self) excludes build/e2e
    // self-tests from the external call count.
    const tag = (args && typeof args === 'object' && args.probe) ? String(args.probe) : currentProbeTag;
    if (tag) entry.probe = tag;
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('Failed to log call:', e.message);
  }
}

// ---- Helper: build a fresh McpServer with all tools registered ----
function createServer() {
  const srv = new McpServer(
    {
      name: NAME,
      version: VERSION,
    },
    {
      instructions: 'Casper Tools MCP server. Provides utilities for JSON inspection, regex testing, cron parsing, hashing, base64 codec, URL analysis, color conversion, text diffing, CSV parsing, JWT decode/verify, Markdown-to-HTML rendering, UUID/token minting, and Semantic Versioning (compare, satisfy, bump, pick upgrade target).',
      capabilities: { tools: {} },
    }
  );

  for (const t of TOOL_DEFS) {
    const premiumWrapper = x402.wrapTool(t.name);
    if (premiumWrapper) {
      // Premium tool: x402 payment-wrapped (USDC on Base via CDP facilitator).
      srv.tool(
        t.name,
        t.description,
        t.inputSchema,
        premiumWrapper(async (args) => {
          logCall(t.name, args);
          return t.run(args);
        })
      );
    } else {
      srv.tool(
        t.name,
        t.description,
        t.inputSchema,
        async (args) => {
          logCall(t.name, args);
          return t.run(args);
        }
      );
    }
  }

  return srv;
}

const app = createMcpExpressApp({ host: '0.0.0.0' });

// ---- HTTP routes ----
async function handleMcp(req, res) {
  let server;
  let transport;
  try {
    currentProbeTag = req.headers['x-probe'] || null;
    server = createServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    currentProbeTag = null;
  } catch (e) {
    console.error('MCP request error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  } finally {
    // The transport manages the response lifecycle; close the server after handling
    if (server && server.isConnected()) {
      try { await server.close(); } catch (e) { /* ignore */ }
    }
  }
}

app.post('/mcp', handleMcp);

// Accept MCP POSTs at the bare host root too, so registry remotes that omit
// the /mcp suffix still work. Collides with no GET route (root is unbound).
app.post('/', handleMcp);

app.get('/mcp', (req, res) => {
  res.json({
    name: NAME,
    version: VERSION,
    description: 'MCP server exposing 16 agentic utilities: JSON inspection, regex testing, cron parsing, hashing, base64 codec, URL analysis, color conversion, text diffing, CSV parsing, JWT decode/verify, Markdown-to-HTML, UUID/token minting, and Semantic Versioning tools (compare, satisfies, bump, max).',
    tools: toolNames(),
    endpoint: 'POST /mcp (MCP Streamable HTTP)',
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Casper MCP Server (${NAME} v${VERSION}) running on port ${PORT}`);
  console.log(`  ${TOOL_DEFS.length} tools registered`);
  console.log(`  GET  /mcp     - server info`);
  console.log(`  POST /mcp     - MCP protocol endpoint`);
  console.log(`  GET  /health  - health check`);
});