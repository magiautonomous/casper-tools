#!/usr/bin/env node
const crypto = require('crypto');
let z;
try {
  z = require('zod');
} catch (e) {
  z = require('@modelcontextprotocol/sdk/node_modules/zod');
}

const trunc = (s, n) => (s.length > n ? s.substring(0, n) + '...' : s);

// ---------------------------------------------------------------------------
// Tool implementation list. Each def: { name, description, inputSchema, run }
// run(args) -> McpContentResult ({ content: [{ type:'text', text }] })
// ---------------------------------------------------------------------------

// ---- csv_parse -------------------------------------------------------------
function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === delim) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  row.push(field);
  rows.push(row);
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

function splitCsvLine(line, delim) {
  const out = [];
  let f = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else inQ = false; }
      else f += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { out.push(f); f = ''; }
    else f += c;
  }
  out.push(f);
  return out;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim() !== '') || '';
  let best = ',', bestCount = -1;
  for (const cand of [',', '\t', ';', '|']) {
    const n = splitCsvLine(firstLine, cand).length;
    if (n > bestCount) { bestCount = n; best = cand; }
  }
  return best;
}

const TOOL_CSV_PARSE = {
  name: 'csv_parse',
  description: 'Parse CSV/TSV/semicolon/pipe-delimited data into rows. Returns column headers, row/column counts, delimiter used, column consistency check, and a JSON preview of the first rows. Handles quoted fields and escaped quotes.',
  inputSchema: {
    csv: z.string().describe('The delimited data to parse'),
    delimiter: z.string().default('auto').describe('Delimiter: auto, comma, tab, semicolon, or pipe'),
    has_header: z.boolean().default(true).describe('Whether the first row is a header row')
  },
  async run({ csv, delimiter, has_header }) {
    const delimMap = { auto: null, comma: ',', tab: '\t', semicolon: ';', pipe: '|' };
    const rawDelim = (delimiter || 'auto').toLowerCase();
    const delim = delimMap[rawDelim] !== undefined ? delimMap[rawDelim] : null;
    if ((delim === null && rawDelim !== 'auto') || delim === '') {
      return { content: [{ type: 'text', text: `Invalid delimiter: "${delimiter}". Use auto, comma, tab, semicolon, or pipe.` }], isError: true };
    }
    const d = delim || detectDelimiter(csv);
    const rows = parseCsv(csv, d);
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'No rows found in input.' }], isError: true };
    }
    const maxCols = Math.max(...rows.map(r => r.length));
    const header = has_header ? rows[0] : null;
    const dataRows = has_header ? rows.slice(1) : rows;
    const names = header
      ? header.map((c, i) => (c && c.trim() !== '' ? c.trim() : `col${i + 1}`))
      : Array.from({ length: maxCols }, (_, i) => `col${i + 1}`);
    const consistent = dataRows.every(r => r.length === names.length);
    const keyed = dataRows.slice(0, 5).map(r => {
      const obj = {};
      names.forEach((n, i) => { obj[n] = r[i] ?? ''; });
      return obj;
    });
    const preview = JSON.stringify(keyed, null, 2);
    const previewSafe = preview.length > 2500 ? preview.substring(0, 2500) + '\n...' : preview;
    const delimLabel = d === '\t' ? 'tab' : d === ',' ? 'comma' : d === ';' ? 'semicolon' : d;
    let txt = `Delimiter: ${delimLabel}${delim === null ? ' (auto-detected)' : ''}\n`;
    txt += `Columns (${names.length}): ${names.join(', ')}\n`;
    txt += `Data rows: ${dataRows.length}${has_header ? ` (+ 1 header row)` : ''} of ${rows.length} total\n`;
    txt += `Column consistency: ${consistent ? 'consistent' : `INCONSISTENT (some rows have fewer/more fields than header)`}\n\n`;
    txt += `JSON preview (first ${Math.min(5, dataRows.length)} rows):\n${previewSafe}`;
    return { content: [{ type: 'text', text: txt }] };
  }
};

// ---- uuid_mint -------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOOL_UUID_MINT = {
  name: 'uuid_mint',
  description: 'Generate RFC 4122 version 4 UUIDs and/or cryptographically random URL-safe tokens. Batch count is clamped to 1-10.',
  inputSchema: {
    kind: z.enum(['uuid', 'token', 'both']).default('uuid').describe('uuid = v4 UUIDs, token = random base64url tokens, both = pairs'),
    count: z.number().int().default(1).describe('How many to generate (clamped 1-10)')
  },
  async run({ kind, count }) {
    const k = kind || 'uuid';
    const n = Math.max(1, Math.min(10, Math.floor(count || 1)));
    const uuids = [];
    const tokens = [];
    for (let i = 0; i < n; i++) {
      if (k === 'uuid' || k === 'both') uuids.push(crypto.randomUUID());
      if (k === 'token' || k === 'both') tokens.push(crypto.randomBytes(16).toString('base64url'));
    }
    let txt;
    if (k === 'uuid') {
      txt = `${n} UUID v4:\n` + uuids.map(u => `  ${u}`).join('\n');
    } else if (k === 'token') {
      txt = `${n} token(s) (128-bit base64url):\n` + tokens.map(t => `  ${t}`).join('\n');
    } else {
      txt = `${n} uuid+token pair(s):\n` + uuids.map((u, i) => `  uuid:   ${u}\n  token:  ${tokens[i]}`).join('\n');
    }
    return { content: [{ type: 'text', text: txt }] };
  }
};

// ---- jwt_decode ------------------------------------------------------------
function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return Buffer.from(s, 'base64');
}

function decodePart(str) {
  const buf = b64urlDecode(str);
  return JSON.parse(buf.toString('utf8'));
}

const TOOL_JWT_DECODE = {
  name: 'jwt_decode',
  description: 'Decode and validate a JWT. Returns header, payload, algorithm, signature presence, and — when a secret is provided — whether an HMAC-SHA256/384/512 signature verifies. Also checks exp/nbf/iat timestamps.',
  inputSchema: {
    token: z.string().describe('The JWT (three dot-separated base64url parts)'),
    secret: z.string().optional().describe('Shared secret to verify HS256/HS384/HS512 signatures')
  },
  async run({ token, secret }) {
    const parts = String(token || '').trim().split('.');
    if (parts.length !== 3) {
      return { content: [{ type: 'text', text: `Invalid JWT: expected 3 dot-separated parts, got ${parts.length}.` }], isError: true };
    }
    let header, payload, signature;
    try {
      header = decodePart(parts[0]);
      payload = decodePart(parts[1]);
      signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    } catch (e) {
      return { content: [{ type: 'text', text: `Invalid JWT encoding: ${e.message}` }], isError: true };
    }
    const alg = header.alg || '(none)';
    const lines = [];
    lines.push(`Header:\n${JSON.stringify(header, null, 2)}`);
    lines.push(`Payload:\n${JSON.stringify(payload, null, 2)}`);
    lines.push(`Signature: ${signature.length} bytes${alg.startsWith('HS') ? ' (HMAC)' : ''}`);

    if (secret && alg.startsWith('HS')) {
      const digestMap = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };
      const dig = digestMap[alg];
      if (!dig) {
        lines.push('Signature verification: skipped (unsupported algorithm for this checker — only HS256/384/512)');
      } else {
        const expected = crypto.createHmac(dig, secret).update(`${parts[0]}.${parts[1]}`).digest();
        const ok = expected.length === signature.length && crypto.timingSafeEqual(expected, signature);
        lines.push(`Signature valid (${alg}${ok ? '' : ' FAILED'}): ${ok ? 'yes — token is authentic' : 'no — token was tampered with or wrong secret'}`);
      }
    } else if (sec(secret)) {
      lines.push('Signature verification: skipped (algorithm not HMAC)');
    } else {
      lines.push('Signature verification: skipped (no secret provided)');
    }

    const now = Math.floor(Date.now() / 1000);
    const tsLine = (claim, label) => {
      if (typeof payload[claim] !== 'number') return null;
      const diff = payload[claim] - now;
      let state;
      if (claim === 'exp') state = diff <= 0 ? 'EXPIRED' : `valid for ${diff}s`;
      else if (claim === 'nbf') state = diff > 0 ? `not yet valid (${diff}s away)` : 'valid';
      else state = `${now - payload[claim]}s ago`;
      return `  ${label} (${payload[claim]}): ${state}`;
    };
    const tss = [tsLine('exp', 'exp'), tsLine('nbf', 'nbf'), tsLine('iat', 'iat')].filter(Boolean);
    if (tss.length) lines.push(`Timestamps (now=${now}):\n${tss.join('\n')}`);

    return { content: [{ type: 'text', text: lines.join('\n\n') }] };
  }
};

// (local helper to avoid `secret` name shadow confusion)
function sec(v) { return v !== undefined && v !== null && v !== ''; }

// ---- markdown_to_html ------------------------------------------------------
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMd(s) {
  const parts = s.split('`');
  const placeholders = [];
  let out = '';
  const restore = (t) => {
    placeholders.forEach((val, pi) => { t = t.split(`\u0000MDK${pi}\u0000`).join(val); });
    return t;
  };
  parts.forEach((p, i) => {
    if (i % 2 === 1) { out += `<code>${p}</code>`; return; }
    let t = escapeHtml(p);
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
      const ph = `\u0000MDK${placeholders.length}\u0000`;
      placeholders.push(`<img alt="${alt}" src="${escapeHtml(src)}">`);
      return ph;
    });
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => {
      const ph = `\u0000MDK${placeholders.length}\u0000`;
      placeholders.push(`<a href="${escapeHtml(href)}">${label}</a>`);
      return ph;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1<em>$2</em>');
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    t = t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
    out += restore(t);
  });
  return out;
}

function renderMarkdown(md) {
  const src = String(md || '').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code${fence[1] ? ` class="language-${fence[1]}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (line.trim() === '') { i++; continue; }

    if (/^\s*>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>\n  <p>${q.map(inlineMd).join(' ')}</p>\n</blockquote>`);
      continue;
    }

    const ul = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ul) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)[-*+]\s+(.*)$/);
        if (!m) break;
        items.push({ level: m[1].length, text: m[2] });
        i++;
      }
      out.push('<ul>\n' + items.map(it => `  <li>${inlineMd(it.text)}</li>`).join('\n') + '\n</ul>');
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      out.push('<ol>\n' + items.map(t => `  <li>${inlineMd(t)}</li>`).join('\n') + '\n</ol>');
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|\s*```|>\s?|[-*+]\s|\d+\.\s)/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push(`<p>${inlineMd(para.join(' '))}</p>`);
  }
  return out.join('\n\n');
}

const TOOL_MARKDOWN_TO_HTML = {
  name: 'markdown_to_html',
  description: 'Convert Markdown to HTML. Supports ATX headings, fenced code blocks, ordered/unordered lists, blockquotes, horizontal rules, paragraphs, inline code, bold/italic/strikethrough, links, images, and auto-linked URLs. Raw HTML in the source is escaped.',
  inputSchema: {
    markdown: z.string().describe('The Markdown source to convert to HTML')
  },
  async run({ markdown }) {
    return { content: [{ type: 'text', text: renderMarkdown(markdown) }] };
  }
};

// ---------------------------------------------------------------------------
// Existing 8 tools (moved from server.js, outputs unchanged)
// ---------------------------------------------------------------------------

const TOOL_JSON_INSPECT = {
  name: 'json_inspect',
  description: 'Parse, validate, and pretty-print JSON strings. Returns whether the input is valid JSON, the parsed data type, keys, and formatted output.',
  inputSchema: {
    input: z.string().describe('The JSON string to inspect')
  },
  async run({ input }) {
    try {
      const parsed = JSON.parse(input);
      const formatted = JSON.stringify(parsed, null, 2);
      const type = Array.isArray(parsed) ? 'array' : typeof parsed;
      let keys = 'N/A';
      if (type === 'object') keys = Object.keys(parsed).join(', ') || '(empty)';
      if (type === 'array') keys = `${parsed.length} item(s)`;
      const preview = formatted.length > 2000 ? formatted.substring(0, 2000) + '\n... (truncated)' : formatted;
      return { content: [{ type: 'text', text: `Valid JSON\nType: ${type}\nKeys/Items: ${keys}\n\n${preview}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `INVALID JSON\nError: ${e.message}` }], isError: true };
    }
  }
};

const TOOL_REGEX_TEST = {
  name: 'regex_test',
  description: 'Test a regular expression against an input string. Returns all matches with their positions and capturing groups.',
  inputSchema: {
    pattern: z.string().describe('The regex pattern to test'),
    flags: z.string().default('g').describe('Regex flags (g, i, m, s, u, etc.)'),
    input: z.string().describe('The string to test the pattern against')
  },
  async run({ pattern, flags, input }) {
    try {
      const regex = new RegExp(pattern, flags);
      const matches = [...input.matchAll(regex)];
      const shown = input.length > 300 ? input.substring(0, 300) + '...' : input;
      if (matches.length === 0) {
        return { content: [{ type: 'text', text: `Pattern: /${pattern}/${flags}\nInput: "${shown}"\n\nResult: No matches found` }] };
      }
      const lines = matches.map((m, i) => {
        let s = `Match ${i + 1}: "${m[0]}" (index ${m.index})`;
        if (m.length > 1) {
          const groups = m.slice(1).map((g, j) => ` $${j + 1}="${g ?? '(undefined)'}"`).join('');
          s += `\n  Groups:${groups}`;
        }
        return s;
      });
      return { content: [{ type: 'text', text: `Pattern: /${pattern}/${flags}\nInput: "${shown}"\n\n${matches.length} match(es):\n${lines.join('\n')}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Invalid regex\nError: ${e.message}` }], isError: true };
    }
  }
};

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

const TOOL_CRON_PARSE = {
  name: 'cron_parse',
  description: 'Parse a cron expression (5 fields) and explain the schedule. Computes and shows the next 5 run times in ISO format.',
  inputSchema: {
    expression: z.string().describe('Cron expression with 5 fields: minute hour day-of-month month day-of-week (e.g. "*/15 * * * *")')
  },
  async run({ expression }) {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      return { content: [{ type: 'text', text: `Invalid cron expression\nExpected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}\nExample: "*/15 * * * *" = every 15 minutes` }], isError: true };
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
    return { content: [{ type: 'text', text: `Expression: ${expression}\n\nHuman-readable:\n${desc}\n\nNext 5 executions (UTC):\n${nextText}` }] };
  }
};

const TOOL_HASH_COMPUTE = {
  name: 'hash_compute',
  description: 'Compute a cryptographic hash of input data. Supports MD5, SHA1, SHA256, and SHA512. Returns the hex digest.',
  inputSchema: {
    input: z.string().describe('The data to hash'),
    algorithm: z.enum(['md5', 'sha1', 'sha256', 'sha512']).default('sha256').describe('Hash algorithm to use')
  },
  async run({ input, algorithm }) {
    const valid = ['md5', 'sha1', 'sha256', 'sha512'];
    const algo = algorithm || 'sha256';
    if (!valid.includes(algo)) {
      return { content: [{ type: 'text', text: `Invalid algorithm: "${algo}". Supported algorithms: ${valid.join(', ')}` }], isError: true };
    }
    const hash = crypto.createHash(algo).update(input, 'utf8').digest('hex');
    const preview = input.length > 100 ? input.substring(0, 100) + '...' : input;
    return { content: [{ type: 'text', text: `Algorithm: ${algo}\nInput: "${preview}"\n\nHash: ${hash}` }] };
  }
};

const TOOL_BASE64_ENCODE = {
  name: 'base64_encode',
  description: 'Encode or decode Base64 data. Useful for binary data, token inspection, and data serialization.',
  inputSchema: {
    input: z.string().describe('The data to encode or decode'),
    mode: z.enum(['encode', 'decode']).default('encode').describe('Whether to encode (normal -> base64) or decode (base64 -> normal)')
  },
  async run({ input, mode }) {
    const m = mode || 'encode';
    try {
      if (m === 'encode') {
        const encoded = Buffer.from(input, 'utf8').toString('base64');
        const preview = input.length > 100 ? input.substring(0, 100) + '...' : input;
        const encodedPreview = encoded.length > 100 ? encoded.substring(0, 100) + '...' : encoded;
        return { content: [{ type: 'text', text: `Mode: encode\nInput: "${preview}"\n\nEncoded: ${encodedPreview}\n\nFull length: ${encoded.length} chars` }] };
      }
      if (m === 'decode') {
        const decoded = Buffer.from(input, 'base64').toString('utf8');
        const preview = decoded.length > 200 ? decoded.substring(0, 200) + '...' : decoded;
        return { content: [{ type: 'text', text: `Mode: decode\n\nDecoded: "${preview}"\n\nFull length: ${decoded.length} chars` }] };
      }
      return { content: [{ type: 'text', text: `Invalid mode: "${m}". Use "encode" or "decode".` }], isError: true };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
};

const TOOL_URL_ANALYZE = {
  name: 'url_analyze',
  description: 'Parse and analyze a URL. Returns protocol, hostname, port, path, query parameters, fragment, and validation status.',
  inputSchema: {
    url: z.string().describe('The URL to analyze (e.g. https://example.com/path?query=1)')
  },
  async run({ url }) {
    try {
      const parsed = new URL(url);
      const params = [...parsed.searchParams.entries()];
      const paramsText = params.length > 0
        ? params.map(([k, v]) => `  ${k} = ${v}`).join('\n')
        : '  (none)';
      return { content: [{ type: 'text', text: `URL: ${url}\n\nProtocol: ${parsed.protocol}${parsed.protocol.includes('s') ? ' (secure)' : ' (insecure)'}\nHost: ${parsed.host}\nHostname: ${parsed.hostname}\nPort: ${parsed.port || '(default)'}\nPath: ${parsed.pathname}\nHash: ${parsed.hash || '(none)'}\n\nQuery parameters (${params.length}):\n${paramsText}${parsed.username ? `\n\nUsername: ${parsed.username}` : ''}${parsed.password ? `\nPassword: ${'*'.repeat(parsed.password.length)}` : ''}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Invalid URL\nError: ${e.message}\n\nTip: ensure the URL includes a scheme like "https://"` }], isError: true };
    }
  }
};

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

const TOOL_COLOR_CONVERT = {
  name: 'color_convert',
  description: 'Convert a color between hex, RGB, HSL, and named formats. Returns the color in all supported representations.',
  inputSchema: {
    color: z.string().describe('The color to convert. Formats: #RRGGBB, #RGB, rgb(r,g,b), hsl(h,s%,l%), or a named color like "red"')
  },
  async run({ color }) {
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
      return { content: [{ type: 'text', text: `Unrecognized color format: "${color}"\n\nSupported formats:\n  #RRGGBB or #RGB (hex)\n  rgb(r, g, b)\n  hsl(h, s%, l%)\n  Named colors: red, blue, green, etc.` }], isError: true };
    }
    const [r, g, b] = rgb;
    const hex = rgbToHex(r, g, b);
    const hsl = rgbToHsl(r, g, b);
    return { content: [{ type: 'text', text: `Input: ${color}\n\nHEX:  ${hex}\nRGB:  rgb(${r}, ${g}, ${b})\nHSL:  hsl(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%)` }] };
  }
};

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

const TOOL_TEXT_DIFF = {
  name: 'text_diff',
  description: 'Compare two texts and show the differences line by line. Returns added/removed/unchanged counts and the diff output.',
  inputSchema: {
    text1: z.string().describe('The original text'),
    text2: z.string().describe('The modified text to compare against the original')
  },
  async run({ text1, text2 }) {
    if (text1 === text2) {
      return { content: [{ type: 'text', text: `Texts are identical (${text1.length} chars, ${text1.split('\n').length} lines). No differences.` }] };
    }
    const { added, removed, unchanged, lines } = diffLines(text1, text2);
    const shown = lines.length > 100 ? lines.slice(0, 100).join('\n') + '\n... (truncated)' : lines.join('\n');
    return { content: [{ type: 'text', text: `Comparison result:\n  +${added} added, -${removed} removed, ${unchanged} unchanged\n\n${shown}` }] };
  }
};

const TOOL_DEFS = [
  TOOL_JSON_INSPECT,
  TOOL_REGEX_TEST,
  TOOL_CRON_PARSE,
  TOOL_HASH_COMPUTE,
  TOOL_BASE64_ENCODE,
  TOOL_URL_ANALYZE,
  TOOL_COLOR_CONVERT,
  TOOL_TEXT_DIFF,
  TOOL_CSV_PARSE,
  TOOL_JWT_DECODE,
  TOOL_MARKDOWN_TO_HTML,
  TOOL_UUID_MINT,
];

function toolNames() {
  return TOOL_DEFS.map(t => t.name);
}

module.exports = { TOOL_DEFS, toolNames, renderMarkdown, parseCsv, detectDelimiter, inlineMd };