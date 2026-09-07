#!/usr/bin/env node
const crypto = require('crypto');
let z;
try {
  z = require('zod');
} catch (e) {
  z = require('@modelcontextprotocol/sdk/node_modules/zod');
}
const semver = require('./semver-engine.js');
const yaml = require('./yaml-engine.js');

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

// ---- semver_* (SemVerForge engine) -----------------------------------------
// Correct SemVer 2.0.0 precedence + npm-style range checking, from the
// pure-JS semver-engine module (no deps).

const TOOL_SEMVER_COMPARE = {
  name: 'semver_compare',
  description: 'Compare two semantic versions with correct SemVer 2.0.0 precedence (e.g. 1.10.0 > 1.9.0 — plain string sort is wrong). Returns -1/0/1, the human relation, and the difference level (major, minor, patch, prerelease).',
  inputSchema: {
    a: z.string().describe('First version, e.g. 1.10.0'),
    b: z.string().describe('Second version, e.g. 1.9.9')
  },
  async run({ a, b }) {
    if (!semver.parse(a) || !semver.parse(b)) {
      return { content: [{ type: 'text', text: `Invalid version: "${a}" or "${b}". Expected major.minor.patch with optional -prerelease/+build.` }], isError: true };
    }
    const c = semver.compare(a, b);
    const relation = c < 0 ? `${a} < ${b}` : c > 0 ? `${a} > ${b}` : `${a} = ${b}`;
    return { content: [{ type: 'text', text: `compare(${a}, ${b}) = ${c}\nRelation: ${relation}\nDifference level: ${semver.diff(a, b) || 'none (equal)'}` }] };
  }
};

const TOOL_SEMVER_SATISFIES = {
  name: 'semver_satisfies',
  description: 'Test whether a version satisfies an npm-style version range (caret ^, tilde ~, >=, <=, <, >, =, hyphen ranges, x-wildcards like 1.2.x, &&/space AND and || OR). Returns whether it satisfies plus the expanded operator bounds so the caller can see why. Prerelease versions only match a range that names their major.minor.patch with an explicit prerelease (same as npm).',
  inputSchema: {
    version: z.string().describe('The version to test, e.g. 1.9.9'),
    range: z.string().describe('The range to test against, e.g. "^1.2.3 || ~2.0.0"')
  },
  async run({ version, range }) {
    if (!semver.parse(version)) {
      return { content: [{ type: 'text', text: `Invalid version: "${version}"` }], isError: true };
    }
    const ok = semver.satisfies(version, range);
    const head = ok ? `YES: ${version} satisfies "${range}"` : `NO: ${version} does NOT satisfy "${range}"`;
    return { content: [{ type: 'text', text: `${head}\nRange expanded: ${semver.explainRange(range)}` }] };
  }
};

const TOOL_SEMVER_BUMP = {
  name: 'semver_bump',
  description: 'Increment a semantic version to the next release level: major, minor, patch, premajor, preminor, prepatch, or prerelease. An optional identifier (e.g. beta) seeds/steps the prerelease tag. Returns the resulting version string.',
  inputSchema: {
    version: z.string().describe('Starting version, e.g. 1.2.3'),
    level: z.enum(['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease']).default('patch').describe('Which segment to increment'),
    identifier: z.string().optional().describe('Prerelease identifier, e.g. beta, rc (optional)')
  },
  async run({ version, level, identifier }) {
    const next = semver.inc(version, level, identifier);
    if (!next) {
      return { content: [{ type: 'text', text: `Invalid version: "${version}" or unknown level "${level}". Levels: major, minor, patch, premajor, preminor, prepatch, prerelease.` }], isError: true };
    }
    let note = '';
    if (level === 'prerelease' && identifier) {
      note = '\n(identifier "' + identifier + '" started a fresh prerelease series)';
    }
    return { content: [{ type: 'text', text: `inc(${version}, ${level}${identifier ? ', ' + identifier : ''}) = ${semver.format(next)}` + note }] };
  }
};

const TOOL_SEMVER_MAX = {
  name: 'semver_max',
  description: 'Pick the BEST version from a comma-separated list that satisfies a range — the highest satisfying version (upgrade target). Correctly excludes inapplicable prereleases (npm rules) and rejects invalid list entries. Returns the max satisfying version or "none".',
  inputSchema: {
    range: z.string().describe('npm-style range, e.g. "^1.0.0"'),
    versions: z.string().describe('Comma-separated version list, e.g. "1.4.1, 1.5.0-beta.1, 1.6.0"')
  },
  async run({ range, versions }) {
    const list = String(versions || '').split(',').map((s) => s.trim()).filter(Boolean);
    const valid = list.filter((v) => semver.parse(v));
    if (!valid.length) {
      return { content: [{ type: 'text', text: `No valid versions found in: "${versions}"` }], isError: true };
    }
    if (valid.length < list.length) {
      // include hint about rejected entries
    }
    const best = semver.maxSatisfying(valid, range);
    const rejected = list.length - valid.length;
    let txt = `Versions checked: ${list.join(', ')}${rejected ? ` (${rejected} invalid ignored)` : ''}\n`;
    txt += `Range: ${range}  →  expanded: ${semver.explainRange(range)}\n`;
    txt += best ? `MAX satisfying (best upgrade target): ${best}` : 'No version in the list satisfies the range.';
    return { content: [{ type: 'text', text: txt }] };
  }
};

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

// ---- time_convert -----------------------------------------------------------
const TIME_UNIT_MS = { sec: 1e3, second: 1e3, min: 6e4, minute: 6e4, h: 36e5, hr: 36e5, hour: 36e5, day: 864e5, week: 6048e5, month: 26298e5, year: 31557e6 };

function timeGetParts(tz, epoch) {
  const parts = {};
  const opts = { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  for (const x of new Intl.DateTimeFormat('en-US', opts).formatToParts(epoch)) if (x.type !== 'literal') parts[x.type] = x.value;
  return parts;
}

function timeZonedEpoch(wall, tz) {
  const guess = Date.UTC(wall.y, wall.M - 1, wall.d, wall.h, wall.m, wall.s || 0);
  const p = timeGetParts(tz, guess);
  const inTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return guess + (guess - inTz);
}

function timeRelative(ms) {
  const delta = ms - Date.now();
  const abs = Math.abs(delta);
  const units = Object.entries(TIME_UNIT_MS).sort((a, b) => b[1] - a[1]);
  for (const [name, size] of units) {
    if (name.length > 3 && abs >= size && abs < size * 365) {
      const n = Math.round(delta / size);
      const r = Math.abs(n);
      return `${r} ${name}${r === 1 ? '' : 's'} ${n < 0 ? 'ago' : 'from now'}`;
    }
  }
  return 'just now';
}

const TOOL_TIME_CONVERT = {
  name: 'time_convert',
  description: 'Convert and explain a date/time: epoch ms/s, ISO 8601, or relative ("2h ago"). Cross-convert timezones (IANA names like America/New_York). Naive inputs treated as UTC.',
  inputSchema: {
    value: z.string().describe('Time input: ISO 8601, epoch seconds or milliseconds, or relative like "2h ago" / "in 3 days" / "now"'),
    from_tz: z.string().optional().describe('IANA timezone the input is in, e.g. America/New_York. Use when the input is a wall-clock time without an offset'),
    to_tz: z.string().optional().describe('IANA timezone to convert to (comma-separated for several), e.g. Europe/Berlin. Default: UTC only')
  },
  async run({ value, from_tz, to_tz }) {
    let ms;
    try {
      ms = (() => {
        const v = String(value).trim().toLowerCase();
        if (v === 'now') return Date.now();
        if (/^\d{10}$/.test(v)) return +v * 1000;
        if (/^\d{13}$/.test(v)) return +v;
        const rel = v.match(/^(?:in\s+)?([+-]?\d+(?:\.\d+)?)\s*(seconds?|secs?|mins?|minutes?|hrs?|hours?|h|days?|weeks?|months?|years?)(?:\s+(?:ago|from now))?$/i);
        if (rel) {
          const n = parseFloat(rel[1]);
          const mult = TIME_UNIT_MS[(rel[2].toLowerCase().replace(/s$/i, ''))] || TIME_UNIT_MS[rel[2].toLowerCase()];
          return v.includes('ago') ? Date.now() - n * mult : Date.now() + n * mult;
        }
        if (from_tz) {
          const dm = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
          const hm = v.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
          const wall = dm ? { y: +dm[1], M: +dm[2], d: +dm[3], h: +(dm[4] || 0), m: +(dm[5] || 0), s: +(dm[6] || 0) }
            : hm ? (() => { const now = new Date(); return { y: now.getUTCFullYear(), M: now.getUTCMonth() + 1, d: now.getUTCDate(), h: +hm[1], m: +hm[2], s: +(hm[3] || 0) }; })()
            : null;
          if (wall) return timeZonedEpoch(wall, from_tz);
        }
        const hasZone = /(z|[+-]\d{2}:?\d{2}(:\d{2})?)$/i.test(v);
        const iso = hasZone ? v : v + 'Z';
        const m = Date.parse(iso);
        if (!isNaN(m)) return m;
        throw new Error('unparsable');
      })();
    } catch (e) {
      return { content: [{ type: 'text', text: `Could not parse "${value}". Try ISO 8601, epoch seconds/ms, or relative like "2h ago" / "now".${from_tz ? ' Ensure from_tz is a valid IANA timezone.' : ''}` }], isError: true };
    }
const d = new Date(ms);
    const out = [`Input: ${value}${from_tz ? ` (wall time in ${from_tz})` : ''}`];
    out.push(`  epoch ms ${ms}`);
    out.push(`  epoch s  ${Math.floor(ms / 1000)}`);
    const utc = timeGetParts('UTC', ms);
    out.push(`  UTC       ${utc.year}-${utc.month}-${utc.day} ${utc.hour}:${utc.minute}:${utc.second} (${d.toUTCString().slice(0, 3)})`);
    const tzs = (to_tz || '').split(',').map(s => s.trim()).filter(Boolean);
    if (from_tz && !to_tz) tzs.push(from_tz);
    for (const tz of tzs) {
      try { const p = timeGetParts(tz, ms); out.push(`  ${tz.padEnd(20)} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`); }
      catch (e) { out.push(`  ${tz}  (invalid IANA timezone)`); }
    }
    out.push(`  human     ${timeRelative(ms)}`);
    return { content: [{ type: 'text', text: out.join('\n') }] };
  }
};

// ---- password_strength ------------------------------------------------------
const COMMON_PASSWORDS = new Set([
  'password','123456','12345678','qwerty','abc123','monkey','1234567','letmein',
  'trustno1','dragon','baseball','iloveyou','master','sunshine','ashley','bailey',
  'passw0rd','shadow','123123','654321','superman','qazwsx','michael','football',
  'password1','password!','welcome','admin','login','pass','guest','test'
]);

const PATTERNS = [
  { re: /(.)\1\1/i, label: 'repeated-char', msg: 'Three or more repeated characters' },
  { re: /^[a-z]+$/i, label: 'letters-only', msg: 'Only letters' },
  { re: /^[0-9]+$/, label: 'digits-only', msg: 'Only digits' },
  { re: /^[a-z0-9]+$/i, label: 'alphanumeric-only', msg: 'Only letters and digits' },
  { re: /password/i, label: 'contains-password', msg: 'Contains the word "password"' },
  { re: /^123/, label: 'starts-123', msg: 'Starts with sequential digits' },
  { re: /^(.)\1+$/, label: 'all-same', msg: 'All characters are the same' },
  { re: /^(?:qwerty|asdfgh|zxcvbn)/i, label: 'keyboard-row', msg: 'Keyboard row sequence' },
];

function shannonEntropy(pw) {
  if (!pw) return 0;
  const len = pw.length;
  const freq = {};
  for (const c of pw) freq[c] = (freq[c] || 0) + 1;
  let entropy = 0;
  for (const c of pw) {
    const p = freq[c] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy * len;
}

function analyzePassword(password) {
  if (!password || typeof password !== 'string') {
    return { score: 0, rating: 'invalid', issues: ['Password must be a non-empty string'] };
  }
  const pw = String(password);
  const len = pw.length;
  const issues = [];
  const positives = [];

  if (len === 0) return { score: 0, rating: 'invalid', issues: ['Empty password'] };

  const lengthScore = len >= 16 ? 25 : len >= 12 ? 20 : len >= 8 ? 12 : len >= 6 ? 5 : 0;
  if (len >= 16) positives.push('Excellent length (16+)');
  else if (len >= 12) positives.push('Good length (12+)');
  else if (len < 8) issues.push('Too short (minimum 8 recommended)');

  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSpecial = /[^a-zA-Z0-9]/.test(pw);
  const classes = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

  const varietyScore = classes * 10;
  if (!hasLower && !hasUpper) issues.push('No letters');
  if (!hasDigit) issues.push('No digits');
  if (!hasSpecial) issues.push('No special characters');
  if (classes === 4) positives.push('All character classes present');

  const entropy = shannonEntropy(pw);
  const entropyScore = Math.min(25, Math.max(0, entropy / 2));
  if (entropy < 20) issues.push('Low entropy (predictable patterns)');
  else if (entropy > 50) positives.push('High entropy');

  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    issues.push('Matches a commonly used password');
  }

  for (const pat of PATTERNS) {
    if (pat.re.test(pw)) issues.push(pat.msg);
  }

  const seqRe = /(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i;
  if (seqRe.test(pw)) issues.push('Contains a sequential character run');

  if (/^\d{4}[-\/]\d{2}[-\/]\d{2}$/.test(pw)) issues.push('Looks like a date');

  const repeatedRe = /(.)\1{2,}/;
  const repeatedMatch = pw.match(repeatedRe);
  if (repeatedMatch && repeatedMatch[0].length >= 3) {
    issues.push(`Repeated character "${repeatedMatch[1]}" x${repeatedMatch[0].length}`);
  }

  let score = Math.round(lengthScore + varietyScore + entropyScore);
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) score = Math.min(score, 15);
  score = Math.max(0, Math.min(100, score));

  let rating;
  if (score >= 80) rating = 'very_strong';
  else if (score >= 60) rating = 'strong';
  else if (score >= 40) rating = 'fair';
  else if (score >= 20) rating = 'weak';
  else rating = 'very_weak';

  const suggestions = [];
  if (len < 12) suggestions.push('Use at least 12 characters (16+ is ideal)');
  if (!hasUpper) suggestions.push('Add uppercase letters');
  if (!hasLower) suggestions.push('Add lowercase letters');
  if (!hasDigit) suggestions.push('Add digits');
  if (!hasSpecial) suggestions.push('Add special characters (!@#$%^&*)');
  if (entropy < 30) suggestions.push('Avoid predictable words or patterns');
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) suggestions.push('This is a commonly hacked password — choose something unique');

  return {
    score,
    rating,
    length: len,
    character_classes: { lowercase: hasLower, uppercase: hasUpper, digits: hasDigit, special: hasSpecial },
    entropy: Math.round(entropy * 100) / 100,
    crack_time_estimate: estimateCrackTime(entropy),
    issues: issues.length ? issues : undefined,
    positives: positives.length ? positives : undefined,
    suggestions: suggestions.length ? suggestions : undefined
  };
}

function estimateCrackTime(entropy) {
  const guessesPerSecond = 1e10;
  const combinations = Math.pow(2, entropy);
  const seconds = combinations / (2 * guessesPerSecond);
  if (seconds < 1) return 'instant';
  if (seconds < 60) return '< 1 minute';
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours`;
  if (seconds < 31536000) return `${Math.round(seconds / 86400)} days`;
  if (seconds < 31536000 * 1000) return `${Math.round(seconds / 31536000 / 1000)} thousand years`;
  return 'effectively forever';
}

const TOOL_PASSWORD_STRENGTH = {
  name: 'password_strength',
  description: 'Analyze password strength. Returns a 0-100 score, rating, length, character-class variety, Shannon entropy, estimated crack time, issues, positives, and improvement suggestions.',
  inputSchema: {
    password: z.string().describe('The password string to analyze')
  },
  async run({ password }) {
    const result = analyzePassword(password);
    const lines = [
      `Password strength analysis:`,
      `  Score:  ${result.score}/100 (${result.rating})`,
      `  Length: ${result.length} characters`,
      `  Classes: ${Object.entries(result.character_classes).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none'}`,
      `  Entropy: ${result.entropy} bits`,
      `  Estimated crack time: ${result.crack_time_estimate}`
    ];
    if (result.issues && result.issues.length) lines.push(`\nIssues:\n${result.issues.map(i => `  - ${i}`).join('\n')}`);
    if (result.positives && result.positives.length) lines.push(`\nPositives:\n${result.positives.map(p => `  + ${p}`).join('\n')}`);
    if (result.suggestions && result.suggestions.length) lines.push(`\nSuggestions:\n${result.suggestions.map(s => `  -> ${s}`).join('\n')}`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
};

const TOOL_YAML_PARSE = {
  name: 'yaml_parse',
  description: 'Parse YAML into JSON. Converts YAML documents (maps, lists, nesting, flow collections {a: 1}, [1,2], inline scalars, multi-document streams with ---) into a JSON object/array. Handles docker-compose, k8s manifests, GitHub Actions and similar configs.',
  inputSchema: {
    yaml: z.string().describe('The YAML text to parse'),
    pretty: z.boolean().default(true).describe('Whether to indent the returned JSON (true) or minify it (false)')
  },
  async run({ yaml: yamlText, pretty }) {
    if (typeof yamlText !== 'string' || yamlText.trim() === '') {
      return { content: [{ type: 'text', text: 'Error: no YAML input provided.' }], isError: true };
    }
    let obj;
    try {
      obj = yaml.parse(yamlText);
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: invalid YAML — ${e.message}` }], isError: true };
    }
    const json = JSON.stringify(obj, null, pretty === false ? 0 : 2);
    let head = `Parsed YAML to JSON:\n`;
    let stats = '';
    try {
      const type = Array.isArray(obj) ? 'array' : typeof obj;
      stats = `  Type: ${type}${Array.isArray(obj) ? ` (${obj.length} items)` : (obj !== null && typeof obj === 'object') ? ` (${Object.keys(obj).length} keys at root)` : ''}\n`;
    } catch (e) {}
    const size = Buffer.byteLength(json, 'utf8');
    const inputSize = Buffer.byteLength(yamlText, 'utf8');
    return { content: [{ type: 'text', text: `${head}${stats}  Input: ${inputSize} bytes, Output: ${size} bytes\n\n${json}` }] };
  }
};

const TOOL_DEFS = [
  TOOL_TIME_CONVERT,
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
  TOOL_PASSWORD_STRENGTH,
  TOOL_YAML_PARSE,
  TOOL_SEMVER_COMPARE,
  TOOL_SEMVER_SATISFIES,
  TOOL_SEMVER_BUMP,
  TOOL_SEMVER_MAX,
];

function toolNames() {
  return TOOL_DEFS.map(t => t.name);
}

module.exports = { TOOL_DEFS, toolNames, renderMarkdown, parseCsv, detectDelimiter, inlineMd, analyzePassword, yaml };