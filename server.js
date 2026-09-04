#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
let z;
try {
  z = require('zod');
} catch (e) {
  z = require('@modelcontextprotocol/sdk/node_modules/zod');
}

const PORT = process.env.MCP_PORT || 3000;

// Analytics: log every tool call
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'calls.jsonl');

function logCall(name, ip) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      tool: name,
      ip: ip || 'unknown',
    };
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('Failed to log call:', e.message);
  }
}

// ---- Helper: build a fresh McpServer with all tools registered ----
function createServer() {
  const srv = new McpServer(
    {
      name: 'casper-tools',
      version: '1.0.0',
    },
    {
      instructions: 'Casper Tools MCP server. Provides utilities for JSON inspection, regex testing, cron parsing, hashing, base64 encoding/decoding, URL analysis, color conversion, and text diffing.',
      capabilities: { tools: {} },
    }
  );

  // Tool 1: json_inspect
  srv.tool(
    'json_inspect',
    'Parse, validate, and pretty-print JSON strings. Returns whether the input is valid JSON, the parsed data type, keys, and formatted output.',
    {
      input: z.string().describe('The JSON string to inspect')
    },
    async ({ input }) => {
      logCall('json_inspect');
      try {
        const parsed = JSON.parse(input);
        const formatted = JSON.stringify(parsed, null, 2);
        const type = Array.isArray(parsed) ? 'array' : typeof parsed;
        let keys = 'N/A';
        if (type === 'object') keys = Object.keys(parsed).join(', ') || '(empty)';
        if (type === 'array') keys = `${parsed.length} item(s)`;
        const preview = formatted.length > 2000 ? formatted.substring(0, 2000) + '\n... (truncated)' : formatted;
        return {
          content: [{ type: 'text', text: `Valid JSON\nType: ${type}\nKeys/Items: ${keys}\n\n${preview}` }]
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `INVALID JSON\nError: ${e.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 2: regex_test
  srv.tool(
    'regex_test',
    'Test a regular expression against an input string. Returns all matches with their positions and capturing groups.',
    {
      pattern: z.string().describe('The regex pattern to test'),
      flags: z.string().default('g').describe('Regex flags (g, i, m, s, u, etc.)'),
      input: z.string().describe('The string to test the pattern against')
    },
    async ({ pattern, flags, input }) => {
      logCall('regex_test');
      try {
        const regex = new RegExp(pattern, flags);
        const matches = [...input.matchAll(regex)];
        const shown = input.length > 300 ? input.substring(0, 300) + '...' : input;
        if (matches.length === 0) {
          return {
            content: [{ type: 'text', text: `Pattern: /${pattern}/${flags}\nInput: "${shown}"\n\nResult: No matches found` }]
          };
        }
        const lines = matches.map((m, i) => {
          let s = `Match ${i + 1}: "${m[0]}" (index ${m.index})`;
          if (m.length > 1) {
            const groups = m.slice(1).map((g, j) => ` $${j + 1}="${g ?? '(undefined)'}"`).join('');
            s += `\n  Groups:${groups}`;
          }
          return s;
        });
        return {
          content: [{ type: 'text', text: `Pattern: /${pattern}/${flags}\nInput: "${shown}"\n\n${matches.length} match(es):\n${lines.join('\n')}` }]
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Invalid regex\nError: ${e.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 3: cron_parse
  function cronMatches(field, value) {
    if (field === '*' || field === '?') return true;
    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [stepBase, step] = part.split('/');
        let range = [0, 59];
        if (stepBase !== '*') {
          const [a, b] = stepBase.split('-').map(Number);
          range = [a, b === undefined ? a : b];
        }
        const stepN = parseInt(step);
        if (!isNaN(stepN) && value >= range[0] && value <= range[1] && (value - range[0]) % stepN === 0) return true;
        continue;
      }
      if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number);
        if (value >= a && value <= b) return true;
        continue;
      }
      if (parseInt(part) === value) return true;
    }
    return false;
  }

  function describeField(field, unitLabel) {
    if (field === '*' || field === '?') return `every ${unitLabel}`;
    if (field.includes('/')) {
      const [base, step] = field.split('/');
      if (base === '*') return `every ${step} ${unitLabel}`;
      return `every ${step} ${unitLabel} from ${base}`;
    }
    if (field.includes(',')) return field.split(',').join(' or ');
    if (field.includes('-')) return `${field.split('-')[0]}-${field.split('-')[1]}`;
    return field;
  }

  srv.tool(
    'cron_parse',
    'Parse a cron expression (5 fields) and explain the schedule. Computes and shows the next 5 run times in ISO format.',
    {
      expression: z.string().describe('Cron expression with 5 fields: minute hour day-of-month month day-of-week (e.g. "*/15 * * * *")')
    },
    async ({ expression }) => {
      logCall('cron_parse');
      const parts = expression.trim().split(/\s+/);
      if (parts.length !== 5) {
        return {
          content: [{ type: 'text', text: `Invalid cron expression\nExpected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}\nExample: "*/15 * * * *" = every 15 minutes` }],
          isError: true
        };
      }
      const [min, hour, dom, month, dow] = parts;

      const desc = [
        `At ${describeField(min, 'minute')} minute(s) past ${describeField(hour, 'hour')} hour(s)`,
        `Day of month: ${describeField(dom, 'day')}`,
        `Month: ${describeField(month, 'month')}`,
        `Day of week: ${describeField(dow, 'weekday')}`,
      ].join('\n');

      const now = new Date();
      const next = [];
      let d = new Date(now.getTime() + 60000);
      const maxIter = 1440 * 30;
      for (let i = 0; i < maxIter && next.length < 5; i++) {
        if (cronMatches(min, d.getMinutes()) &&
            cronMatches(hour, d.getHours()) &&
            cronMatches(dom, d.getDate()) &&
            cronMatches(month, d.getMonth() + 1) &&
            cronMatches(dow, d.getDay())) {
          next.push(d.toISOString());
        }
        d = new Date(d.getTime() + 60000);
      }

      const nextText = next.length > 0
        ? next.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
        : '  (could not compute within 30 days)';

      return {
        content: [{ type: 'text', text: `Expression: ${expression}\n\nHuman-readable:\n${desc}\n\nNext 5 executions (UTC):\n${nextText}` }]
      };
    }
  );

  // Tool 4: hash_compute
  srv.tool(
    'hash_compute',
    'Compute a cryptographic hash of input data. Supports MD5, SHA1, SHA256, and SHA512. Returns the hex digest.',
    {
      input: z.string().describe('The data to hash'),
      algorithm: z.enum(['md5', 'sha1', 'sha256', 'sha512']).default('sha256').describe('Hash algorithm to use')
    },
    async ({ input, algorithm }) => {
      logCall('hash_compute');
      const valid = ['md5', 'sha1', 'sha256', 'sha512'];
      const algo = algorithm || 'sha256';
      if (!valid.includes(algo)) {
        return {
          content: [{ type: 'text', text: `Invalid algorithm: "${algo}". Supported algorithms: ${valid.join(', ')}` }],
          isError: true
        };
      }
      const hash = crypto.createHash(algo).update(input, 'utf8').digest('hex');
      const preview = input.length > 100 ? input.substring(0, 100) + '...' : input;
      return {
        content: [{ type: 'text', text: `Algorithm: ${algo}\nInput: "${preview}"\n\nHash: ${hash}` }]
      };
    }
  );

  // Tool 5: base64_encode
  srv.tool(
    'base64_encode',
    'Encode or decode Base64 data. Useful for binary data, token inspection, and data serialization.',
    {
      input: z.string().describe('The data to encode or decode'),
      mode: z.enum(['encode', 'decode']).default('encode').describe('Whether to encode (normal -> base64) or decode (base64 -> normal)')
    },
    async ({ input, mode }) => {
      logCall('base64_encode');
      const m = mode || 'encode';
      try {
        if (m === 'encode') {
          const encoded = Buffer.from(input, 'utf8').toString('base64');
          const preview = input.length > 100 ? input.substring(0, 100) + '...' : input;
          const encodedPreview = encoded.length > 100 ? encoded.substring(0, 100) + '...' : encoded;
          return {
            content: [{ type: 'text', text: `Mode: encode\nInput: "${preview}"\n\nEncoded: ${encodedPreview}\n\nFull length: ${encoded.length} chars` }]
          };
        }
        if (m === 'decode') {
          const decoded = Buffer.from(input, 'base64').toString('utf8');
          const preview = decoded.length > 200 ? decoded.substring(0, 200) + '...' : decoded;
          return {
            content: [{ type: 'text', text: `Mode: decode\n\nDecoded: "${preview}"\n\nFull length: ${decoded.length} chars` }]
          };
        }
        return {
          content: [{ type: 'text', text: `Invalid mode: "${m}". Use "encode" or "decode".` }],
          isError: true
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 6: url_analyze
  srv.tool(
    'url_analyze',
    'Parse and analyze a URL. Returns protocol, hostname, port, path, query parameters, fragment, and validation status.',
    {
      url: z.string().describe('The URL to analyze (e.g. https://example.com/path?query=1)')
    },
    async ({ url }) => {
      logCall('url_analyze');
      try {
        const parsed = new URL(url);
        const params = [...parsed.searchParams.entries()];
        const paramsText = params.length > 0
          ? params.map(([k, v]) => `  ${k} = ${v}`).join('\n')
          : '  (none)';
        return {
          content: [{ type: 'text', text: `URL: ${url}\n\nProtocol: ${parsed.protocol}${parsed.protocol.includes('s') ? ' (secure)' : ' (insecure)'}\nHost: ${parsed.host}\nHostname: ${parsed.hostname}\nPort: ${parsed.port || '(default)'}\nPath: ${parsed.pathname}\nHash: ${parsed.hash || '(none)'}\n\nQuery parameters (${params.length}):\n${paramsText}${parsed.username ? `\n\nUsername: ${parsed.username}` : ''}${parsed.password ? `\nPassword: ${'*'.repeat(parsed.password.length)}` : ''}` }]
        };
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Invalid URL\nError: ${e.message}\n\nTip: ensure the URL includes a scheme like "https://"` }],
          isError: true
        };
      }
    }
  );

  // Tool 7: color_convert
  function hexToRgb(hex) {
    let h = hex.replace('#', '').toLowerCase();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const m = h.match(/^[0-9a-f]{6}$/);
    if (!m) return null;
    return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  }

  function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, Math.round(l * 100)];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }

  function hslToRgb(h, s, l) {
    const sn = s / 100, ln = l / 100, hn = h / 360;
    if (sn === 0) {
      const v = Math.round(ln * 255);
      return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;
    return [
      Math.round(hue2rgb(p, q, hn + 1/3) * 255),
      Math.round(hue2rgb(p, q, hn) * 255),
      Math.round(hue2rgb(p, q, hn - 1/3) * 255),
    ];
  }

  const NAMED_COLORS = {
    red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
    yellow: [255, 255, 0], cyan: [0, 255, 255], magenta: [255, 0, 255],
    white: [255, 255, 255], black: [0, 0, 0], gray: [128, 128, 128],
    grey: [128, 128, 128], orange: [255, 165, 0], purple: [128, 0, 128],
    pink: [255, 192, 203], brown: [165, 42, 42], lime: [0, 255, 0],
    teal: [0, 128, 128], navy: [0, 0, 128], olive: [128, 128, 0],
    maroon: [128, 0, 0], gold: [255, 215, 0], coral: [255, 127, 80],
    bisque: [255, 228, 196], chocolate: [210, 105, 30], crimson: [220, 20, 60],
    indigo: [75, 0, 130], ivory: [255, 255, 240], lavender: [230, 230, 250],
    salmon: [250, 128, 114], silver: [192, 192, 192], tan: [210, 180, 140],
    violet: [238, 130, 238], aqua: [0, 255, 255], fuchsia: [255, 0, 255],
    aliceblue: [240, 248, 255],
  };

  srv.tool(
    'color_convert',
    'Convert a color between hex, RGB, HSL, and named formats. Returns the color in all supported representations.',
    {
      color: z.string().describe('The color to convert. Formats: #RRGGBB, #RGB, rgb(r,g,b), hsl(h,s%,l%), or a named color like "red"')
    },
    async ({ color }) => {
      logCall('color_convert');
      let rgb = null;
      const input = color.trim().toLowerCase();

      if (NAMED_COLORS[input]) rgb = NAMED_COLORS[input];
      if (!rgb) rgb = hexToRgb(input);
      if (!rgb) {
        const m = input.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
        if (m) rgb = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
      }
      if (!rgb) {
        const m = input.match(/^hsl\s*\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)$/i);
        if (m) rgb = hslToRgb(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
      }

      if (!rgb) {
        return {
          content: [{ type: 'text', text: `Unrecognized color format: "${color}"\n\nSupported formats:\n  #RRGGBB or #RGB (hex)\n  rgb(r, g, b)\n  hsl(h, s%, l%)\n  Named colors: red, blue, green, etc.` }],
          isError: true
        };
      }

      const [r, g, b] = rgb;
      const hex = rgbToHex(r, g, b);
      const hsl = rgbToHsl(r, g, b);

      return {
        content: [{ type: 'text', text: `Input: ${color}\n\nHEX:  ${hex}\nRGB:  rgb(${r}, ${g}, ${b})\nHSL:  hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)` }]
      };
    }
  );

  // Tool 8: text_diff
  function diffLines(text1, text2) {
    const lines1 = text1.split('\n');
    const lines2 = text2.split('\n');
    const maxLen = Math.max(lines1.length, lines2.length);
    let added = 0, removed = 0, unchanged = 0;
    const result = [];
    for (let i = 0; i < maxLen; i++) {
      const l1 = lines1[i];
      const l2 = lines2[i];
      if (l1 === l2) {
        unchanged++;
        result.push(`  ${l1}`);
      } else {
        if (l1 !== undefined) { removed++; result.push(`- ${l1}`); }
        if (l2 !== undefined) { added++; result.push(`+ ${l2}`); }
      }
    }
    return { added, removed, unchanged, lines: result };
  }

  srv.tool(
    'text_diff',
    'Compare two texts and show the differences line by line. Returns added/removed/unchanged counts and the diff output.',
    {
      text1: z.string().describe('The original text'),
      text2: z.string().describe('The modified text to compare against the original')
    },
    async ({ text1, text2 }) => {
      logCall('text_diff');
      if (text1 === text2) {
        return {
          content: [{ type: 'text', text: `Texts are identical (${text1.length} chars, ${text1.split('\n').length} lines). No differences.` }]
        };
      }
      const { added, removed, unchanged, lines } = diffLines(text1, text2);
      const shown = lines.length > 100 ? lines.slice(0, 100).join('\n') + '\n... (truncated)' : lines.join('\n');
      return {
        content: [{ type: 'text', text: `Comparison result:\n  +${added} added, -${removed} removed, ${unchanged} unchanged\n\n${shown}` }]
      };
    }
  );

  return srv;
}

const app = createMcpExpressApp({ host: '0.0.0.0' });

// ---- HTTP routes ----
app.post('/mcp', async (req, res) => {
  let server;
  let transport;
  try {
    server = createServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
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
});

app.get('/mcp', (req, res) => {
  res.json({
    name: 'casper-tools',
    version: '1.0.0',
    description: 'MCP server exposing 8 agentic utilities: JSON inspection, regex testing, cron parsing, hashing, base64 codec, URL analysis, color conversion, and text diffing.',
    tools: ['json_inspect', 'regex_test', 'cron_parse', 'hash_compute', 'base64_encode', 'url_analyze', 'color_convert', 'text_diff'],
    endpoint: 'POST /mcp (MCP Streamable HTTP)',
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Casper MCP Server (casper-tools v1.0.0) running on port ${PORT}`);
  console.log(`  GET  /mcp     - server info`);
  console.log(`  POST /mcp     - MCP protocol endpoint`);
  console.log(`  GET  /health  - health check`);
});
