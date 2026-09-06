#!/usr/bin/env node
'use strict';
/*
 * semver-engine.js — pure SemVer 2.0.0 parse / compare / bump / range engine.
 * ZERO dependencies. Loaded directly by the browser page AND Node tests, so all
 * exports are plain functions on `module.exports` (Node) / `window.SemVer`
 * (browser).
 *
 * What agents get right with this instead of eyeballing versions:
 *   - correct precedence (1.10.0 > 1.9.0 — string sort lies)
 *   - prerelease ordering (1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-beta < 1.0.0)
 *   - npm-style ranges: ^ ~ >= <= < > =, hyphen, x-wildcards, || OR
 */

const SEMVER_RE = /^[v=]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NUMERIC = /^\d+$/;

function parse(v) {
  if (typeof v !== 'string') return null;
  const m = SEMVER_RE.exec(v.trim());
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] ? m[4].split('.') : [],
    build: m[5] ? m[5].split('.') : [],
    raw: v.trim(),
  };
}

function format(sv) {
  let s = `${sv.major}.${sv.minor}.${sv.patch}`;
  if (sv.prerelease && sv.prerelease.length) s += '-' + sv.prerelease.join('.');
  if (sv.build && sv.build.length) s += '+' + sv.build.join('.');
  return s;
}

// Prerelease identifier comparison: numeric ids compare numerically, numeric <
// alphanumeric, alphanumeric compare ASCII.
function compareIdentifier(a, b) {
  const aNum = NUMERIC.test(a);
  const bNum = NUMERIC.test(b);
  if (aNum && bNum) {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function comparePrerelease(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i], bv = b[i];
    if (av === undefined) return -1; // b has more ids -> b is greater
    if (bv === undefined) return 1;
    const c = compareIdentifier(av, bv);
    if (c !== 0) return c;
  }
  return 0;
}

// Full SemVer precedence. Build metadata does NOT participate.
function compare(a, b) {
  const A = typeof a === 'string' ? parse(a) : a;
  const B = typeof b === 'string' ? parse(b) : b;
  if (!A) throw new Error(`Invalid version: ${a}`);
  if (!B) throw new Error(`Invalid version: ${b}`);
  if (A.major !== B.major) return A.major < B.major ? -1 : 1;
  if (A.minor !== B.minor) return A.minor < B.minor ? -1 : 1;
  if (A.patch !== B.patch) return A.patch < B.patch ? -1 : 1;
  if (A.prerelease.length === 0 && B.prerelease.length === 0) return 0;
  if (A.prerelease.length === 0) return 1; // 1.0.0 > 1.0.0-alpha
  if (B.prerelease.length === 0) return -1;
  return comparePrerelease(A.prerelease, B.prerelease);
}

const eq  = (a, b) => { try { return compare(a, b) === 0; } catch { return false; } };
const neq = (a, b) => !eq(a, b);
const gt  = (a, b) => { try { return compare(a, b) > 0; } catch { return false; } };
const gte = (a, b) => { try { return compare(a, b) >= 0; } catch { return false; } };
const lt  = (a, b) => { try { return compare(a, b) < 0; } catch { return false; } };
const lte = (a, b) => { try { return compare(a, b) <= 0; } catch { return false; } };

function cmp(a, op, b) {
  switch (op) {
    case '>': return gt(a, b);
    case '>=': return gte(a, b);
    case '<': return lt(a, b);
    case '<=': return lte(a, b);
    case '=':
    case '==': return eq(a, b);
    default: throw new Error(`Unknown comparator ${op}`);
  }
}

function prerelease(v) {
  const sv = typeof v === 'string' ? parse(v) : v;
  if (!sv) return null;
  return sv.prerelease.length ? sv.prerelease : null;
}

function diff(a, b) {
  const A = parse(a), B = parse(b);
  if (!A || !B) return null;
  if (A.major !== B.major) return 'major';
  if (A.minor !== B.minor) return 'minor';
  if (A.patch !== B.patch) return 'patch';
  if (A.prerelease.length || B.prerelease.length) {
    if (format(A) === format(B)) return 'prerelease';
    return comparePrerelease(A.prerelease, B.prerelease) < 0
      ? (B.prerelease.length ? 'prerelease' : 'patch')
      : (A.prerelease.length ? 'prerelease' : 'patch');
  }
  return null;
}

// Loose coercion: pull a usable version out of near-version strings.
// "v1.2" -> 1.2.0, "1" -> 1.0.0, "1.2.3.4" -> 1.2.3, "01.02.003" -> 1.2.3
function coerce(v) {
  if (typeof v !== 'string') return null;
  if (parse(v)) return parse(v);
  let m = v.trim().match(/(\d+)(?:\.(\d+)){0,3}/);
  if (!m) return null;
  const nums = m[0].split('.').map((n) => parseInt(n, 10));
  const [major, minor = 0, patch = 0] = nums;
  const clean = (n) => (NUMERIC.test(String(n)) ? parseInt(n, 10) : 0);
  return { major: clean(major), minor: clean(minor), patch: clean(patch), prerelease: [], build: [], raw: m[0] };
}

// Bump: release in major, minor, patch, premajor, preminor, prepatch, prerelease.
function inc(v, release, identifier) {
  const base = typeof v === 'string' ? parse(v) : v;
  if (!base) return null;
  const sv = { major: base.major, minor: base.minor, patch: base.patch, prerelease: [], build: [] };
  const pre = (ids) => {
    // premajor/preminor/prepatch: fresh prerelease, identifier -> [id, "0"]
    const trimmed = identifier === undefined || identifier === null ? null : String(identifier).trim();
    if (trimmed) return [trimmed, '0'];
    return ids.length ? ids : ['0'];
  };
  switch (release) {
    case 'major':
      if (base.prerelease.length) { sv.major++; sv.minor = 0; sv.patch = 0; }
      else { sv.major++; sv.minor = 0; sv.patch = 0; }
      sv.prerelease = [];
      break;
    case 'minor':
      sv.minor++; sv.patch = 0; sv.prerelease = [];
      break;
    case 'patch':
      sv.patch++; sv.prerelease = [];
      break;
    case 'premajor':
      sv.major++; sv.minor = 0; sv.patch = 0; sv.prerelease = pre([]);
      break;
    case 'preminor':
      sv.minor++; sv.patch = 0; sv.prerelease = pre([]);
      break;
    case 'prepatch':
      sv.patch++; sv.prerelease = pre([]);
      break;
    case 'prerelease':
      sv.major = base.major; sv.minor = base.minor; sv.patch = base.patch;
      if (identifier !== undefined && identifier !== null && String(identifier).trim() !== '') {
        const id = String(identifier).trim();
        if (base.prerelease.length && base.prerelease[0] === id) {
          const rest = base.prerelease.slice(1);
          if (rest.length && NUMERIC.test(rest[rest.length - 1])) {
            const bumped = rest.slice(0, -1).concat(String(parseInt(rest[rest.length - 1], 10) + 1));
            sv.prerelease = [id, ...bumped];
          } else {
            sv.prerelease = [id, ...rest, '0'];
          }
        } else {
          sv.prerelease = [id, '0'];
        }
      } else if (base.prerelease.length) {
        const last = base.prerelease[base.prerelease.length - 1];
        if (NUMERIC.test(last)) {
          const bumped = base.prerelease.map((p, i) => (i === base.prerelease.length - 1 ? String(parseInt(p, 10) + 1) : p));
          sv.prerelease = bumped;
        } else if (base.prerelease.length === 1) {
          sv.prerelease = [last, '0'];
        } else {
          sv.prerelease = base.prerelease.concat(['0']);
        }
      } else {
        sv.patch++; sv.prerelease = pre([]);
      }
      break;
    default:
      return null;
  }
  return sv;
}

// ---------------------------------------------------------------------------
// Range support (npm-style subset). parseRange returns a structured tree:
// [ { comps: [ {op, ver, raw, text} ] } ]  — one entry per || branch (AND set)
// ---------------------------------------------------------------------------

const OP_RE = /^(\^|~|>=|<=|>|<|=|==)?/;
const REMAINDER_RE = /^v?(\d+|[xX*])?(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function partsOf(rem) {
  const m = REMAINDER_RE.exec(rem);
  if (!m) return null;
  const W = (x) => x === undefined || x === '' || x === '*' || x === 'x' || x === 'X';
  const wMajor = W(m[1]);
  return {
    major: m[1] && m[1] !== '' ? m[1] : '*',
    minor: m[2] === undefined ? '*' : (W(m[2]) ? '*' : m[2]),
    patch: m[3] === undefined ? '*' : (W(m[3]) ? '*' : m[3]),
    pre: m[4] ? m[4].split('.') : [],
    build: m[5] ? m[5].split('.') : [],
    wildcards: [wMajor, m[2] === undefined || W(m[2]), m[3] === undefined || W(m[3])],
    raw: rem,
  };
}

function verOf(parts) {
  if (parts.major === '*' || parts.major === 'x' || parts.major === 'X') return null;
  return {
    major: parseInt(parts.major, 10),
    minor: parseInt(parts.minor === '*' || parts.minor === 'x' || parts.minor === 'X' ? 0 : parts.minor, 10),
    patch: parseInt(parts.patch === '*' || parts.patch === 'x' || parts.patch === 'X' || parts.patch === undefined ? 0 : parts.patch, 10),
    prerelease: parts.pre || [],
    build: [],
  };
}

// Turn a bare token (already op-stripped) into concrete comparator bounds.
function boundsFromParts(parts, op) {
  const [wMaj, wMin, wPat] = parts.wildcards;
  const comps = [];
  const add = (o, sv) => comps.push({ op: o, ver: sv, raw: parts.raw || '', text: `${o}${format(sv)}` });
  const major = parseInt(parts.major, 10);
  const minor = parts.minor === '*' || parts.minor === 'x' || parts.minor === 'X' || parts.minor === undefined ? null : parseInt(parts.minor, 10);
  const patch = parts.patch === '*' || parts.patch === 'x' || parts.patch === 'X' || parts.patch === undefined ? null : parseInt(parts.patch, 10);

  // Exact full version with optional prerelease.
  if (!wMaj && !wMin && !wPat) {
    const sv = verOf(parts);
    switch (op) {
      case '=':
      case '==':
      case '': add('=', sv); break;
      case '>':
        if (sv.prerelease.length) add('>', sv);
        else add('>=', { major, minor: minor === null ? 0 : minor, patch: patch + 1, prerelease: [] });
        break;
      case '>=': add('>=', sv); break;
      case '<': add('<', sv); break;
      case '<=': add('<=', sv); break;
      case '~':
        add('>=', sv);
        if (minor !== null) add('<', { major, minor: minor + 1, patch: 0, prerelease: [] });
        else add('<', { major: major + 1, minor: 0, patch: 0, prerelease: [] });
        break;
      case '^':
        add('>=', sv);
        if (major > 0) add('<', { major: major + 1, minor: 0, patch: 0, prerelease: [] });
        else if (minor !== null && minor > 0) add('<', { major: 0, minor: minor + 1, patch: 0, prerelease: [] });
        else add('<', { major: 0, minor: 0, patch: patch + 1, prerelease: [] });
        break;
    }
    return comps;
  }

  // Partial / wildcard forms.
  const empty = (maj, min, pat, pre) => ({ major: maj, minor: min, patch: pat, prerelease: pre, build: [] });

  switch (op) {
    case '>': {
      const v = verOf(parts);
      if (minor !== null && patch !== null) { v.minor++; v.patch = 0; add('>=', v); }
      else if (minor !== null) { v.minor++; v.patch = 0; add('>=', v); }
      else { v.major++; v.minor = 0; v.patch = 0; add('>=', v); }
      break;
    }
    case '>=': add('>=', empty(major, minor === null ? 0 : minor, patch === null ? 0 : patch, [])); break;
    case '<':
      if (minor === null) add('<', empty(major, 0, 0, []));
      else if (patch === null) add('<', empty(major, minor, 0, []));
      else add('<', empty(major, minor, patch, []));
      break;
    case '<=':
      if (minor === null) add('<', empty(major + 1, 0, 0, []));
      else if (patch === null) add('<', empty(major, minor + 1, 0, []));
      else add('<=', empty(major, minor, patch, []));
      break;
    case '=':
    case '==':
    case '':
      if (minor === null) { add('>=', empty(major, 0, 0, [])); add('<', empty(major + 1, 0, 0, [])); }
      else if (patch === null) { add('>=', empty(major, minor, 0, [])); add('<', empty(major, minor + 1, 0, [])); }
      else add('=', empty(major, minor, patch, []));
      break;
    case '~':
      add('>=', empty(major, minor === null ? 0 : minor, patch === null ? 0 : patch, parts.pre || []));
      if (minor === null) add('<', empty(major + 1, 0, 0, []));
      else add('<', empty(major, minor + 1, 0, []));
      break;
    case '^':
      if (major > 0) {
        add('>=', empty(major, minor === null ? 0 : minor, patch === null ? 0 : patch, parts.pre || []));
        add('<', empty(major + 1, 0, 0, []));
      } else if (minor === null || minor === undefined) {
        add('>=', empty(0, 0, 0, []));
        add('<', empty(1, 0, 0, []));
      } else if (parts.patch === '*' || parts.patch === 'x' || parts.patch === 'X') {
        if (minor > 0) { add('>=', empty(0, minor, 0, parts.pre || [])); add('<', empty(0, minor + 1, 0, [])); }
        else { add('>=', empty(0, 0, 0, parts.pre || [])); add('<', empty(0, 1, 0, [])); }
      } else if (minor > 0) {
        add('>=', empty(0, minor, patch === null ? 0 : patch, parts.pre || []));
        add('<', empty(0, minor + 1, 0, []));
      } else {
        add('>=', empty(0, 0, patch === null ? 0 : patch, parts.pre || []));
        add('<', empty(0, 0, patch + 1, []));
      }
      break;
  }
  return comps;
}

function parseRange(range) {
  if (typeof range !== 'string') return null;
  const r = range.trim();
  if (r === '') return [{ comps: [{ op: 'any', ver: null, raw: '', text: '*' }] }];
  const branches = r.split('||').map((s) => s.trim());
  if (branches.some((b) => b === '')) return null;
  const out = [];

  for (const branch of branches) {
    const tokens = branch.split(/\s+|,/).filter((t) => t !== '');
    const comps = [];
    const hasWildAny = tokens.some((t) => t === '*' || t === 'x' || t === 'X');
    if (hasWildAny) { comps.push({ op: 'any', ver: null, raw: '*', text: '*' }); out.push({ comps, raw: branch }); continue; }

    // Hyphen ranges: 'a - b'
    const hyphenIdx = tokens.indexOf('-');
    if (hyphenIdx > 0 && hyphenIdx < tokens.length - 1) {
      const left = tokens[hyphenIdx - 1];
      const right = tokens[hyphenIdx + 1];
      tokens.splice(hyphenIdx - 1, 3, left + '-x-' + right);
    }

    for (const tok of tokens) {
      if (tok.startsWith('*') || tok === 'x' || tok === 'X') { comps.push({ op: 'any', ver: null, raw: tok, text: '*' }); continue; }
      const hy = tok.indexOf('-x-');
      if (hy !== -1) {
        const left = tok.slice(0, hy);
        const right = tok.slice(hy + 3);
        const lp = partsOf(left);
        const rp = partsOf(right);
        const L = verOf(lp);
        if (L) {
          const lv = { major: L.major, minor: L.minor, patch: L.patch, prerelease: lp.pre || [], build: [] };
          if (!lp.wildcards[0] && !lp.wildcards[1] && !lp.wildcards[2]) comps.push({ op: '>=', ver: lv, raw: `[${left}]`, text: `>=${format(lv)}` });
          else if (!lp.wildcards[0] && !lp.wildcards[1]) comps.push({ op: '>=', ver: { major: lv.major, minor: lv.minor, patch: 0, prerelease: [], build: [] }, raw: `[${left}]`, text: `>=${lv.major}.${lv.minor}.0` });
          else if (!lp.wildcards[0]) comps.push({ op: '>=', ver: { major: lv.major, minor: 0, patch: 0, prerelease: [], build: [] }, raw: `[${left}]`, text: `>=${lv.major}.0.0` });
        }
        const R = verOf(rp);
        if (R) {
          if (!rp.wildcards[0] && !rp.wildcards[1] && !rp.wildcards[2]) comps.push({ op: '<=', ver: { major: R.major, minor: R.minor, patch: R.patch, prerelease: rp.pre || [], build: [] }, raw: `[${right}]`, text: `<=${format(R)}` });
          else if (!rp.wildcards[0] && !rp.wildcards[1]) comps.push({ op: '<', ver: { major: R.major, minor: R.minor + 1, patch: 0, prerelease: [], build: [] }, raw: `[${right}]`, text: `<${R.major}.${R.minor + 1}.0` });
          else if (!rp.wildcards[0]) comps.push({ op: '<', ver: { major: R.major + 1, minor: 0, patch: 0, prerelease: [], build: [] }, raw: `[${right}]`, text: `<${R.major + 1}.0.0` });
          else comps.push({ op: 'any', ver: null, raw: `[${right}]`, text: '*' });
        }
        continue;
      }
      const m = OP_RE.exec(tok);
      const op = m[0] || '';
      const rem = tok.slice(m[0].length);
      if (rem === '' || rem === '*' || rem === 'x' || rem === 'X') {
        comps.push({ op: 'any', ver: null, raw: tok, text: '*' });
        continue;
      }
      const parts = partsOf(rem);
      if (!parts) { comps.push({ op: 'invalid', ver: null, raw: tok, text: tok }); continue; }
      const got = boundsFromParts(parts, op);
      got.forEach((c) => { c.raw = tok; });
      comps.push(...got);
    }
    if (comps.every((c) => c.op === 'invalid')) return null;
    out.push({ comps, raw: branch });
  }
  return out;
}

function satisfies(v, range) {
  const sv = typeof v === 'string' ? parse(v) : v;
  if (!sv || typeof range !== 'string') return false;
  if (range.trim() === '') return true;
  const tree = parseRange(range);
  if (!tree) return false;

  for (const branch of tree) {
    const comps = branch.comps;
    if (comps.some((c) => c.op === 'invalid')) continue;

    // Prerelease gate: a prerelease version only satisfies a comparator set
    // that names the same [major.minor.patch] triple with an explicit
    // prerelease (mirrors node-semver; also excludes prereleases from plain
    // wildcards like `*`).
    if (sv.prerelease.length) {
      const preTriples = new Set();
      for (const c of comps) {
        if (c.ver && c.ver.prerelease && c.ver.prerelease.length) {
          preTriples.add(`${c.ver.major},${c.ver.minor},${c.ver.patch}`);
        }
      }
      if (preTriples.size === 0) continue;
      if (!preTriples.has(`${sv.major},${sv.minor},${sv.patch}`)) continue;
    }

    if (comps.every((c) => c.op === 'any')) return true;

    let ok = true;
    for (const c of comps) {
      if (c.op === 'any') continue;
      if (!cmp(format(sv), c.op, c.ver)) { ok = false; break; }
    }
    if (ok) { tree._meta = branch; return true; }
  }
  return false;
}

function maxSatisfying(list, range) {
  let best = null;
  for (const v of list) {
    if (!satisfies(v, range)) continue;
    if (!best || gt(v, best)) best = v;
  }
  return best;
}

function minSatisfying(list, range) {
  let best = null;
  for (const v of list) {
    if (!satisfies(v, range)) continue;
    if (!best || lt(v, best)) best = v;
  }
  return best;
}

// Human-readable explanation of a version for the UI / agents.
function explain(v) {
  const sv = typeof v === 'string' ? parse(v) : v;
  if (!sv) return null;
  const lines = [];
  lines.push(`${sv.major}.${sv.minor}.${sv.patch}  — major ${sv.major}, minor ${sv.minor}, patch ${sv.patch}`);
  if (sv.prerelease.length) {
    lines.push(`prerelease: ${sv.prerelease.join('.')}  (${sv.prerelease.map((p) => (NUMERIC.test(p) ? 'numeric id' : 'alphanumeric id')).join(', ')})`);
    const next = inc(sv, 'prerelease');
    if (next) lines.push(`next prerelease: ${format(next)}`);
  } else {
    lines.push('no prerelease — a stable release (precedes any prerelease of the same version)');
  }
  if (sv.build.length) lines.push(`build metadata: ${sv.build.join('.')}  (ignored for precedence)`);
  return lines.join('\n');
}

function explainRange(range) {
  const tree = parseRange(range);
  if (!tree) return range + '  — invalid range';
  return tree.map((branch) => branch.comps.map((c) => c.text).join(' AND ')).join(' OR ');
}

function clean(v) {
  const sv = typeof v === 'string' ? parse(v) : v;
  if (!sv) return null;
  return { ...sv, build: [] };
}

const api = {
  parse, format, compare, compareIdentifier, prerelease,
  eq, neq, gt, gte, lt, lte, cmp,
  satisfies, parseRange, maxSatisfying, minSatisfying,
  inc, diff, coerce, explain, explainRange, clean,
  version: '1.0.0',
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.SemVer = api;