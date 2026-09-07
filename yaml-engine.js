'use strict';

function isNullish(v) { return v === null || v === undefined || v === ''; }
function normalizeScalar(raw) {
  if (isNullish(raw)) return null;
  let s = String(raw).trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (s.length > 1 && ((s[0] === '"' && s[s.length-1] === '"') || (s[0] === "'" && s[s.length-1] === "'"))) {
    s = s.slice(1, -1);
  }
  const n = Number(s);
  if (String(n) === s && Number.isFinite(n)) return n;
  return s;
}

class Parser {
  constructor(input) {
    this.lines = input.split('\n');
    this.pos = 0;
  }
  peek() { return this.pos < this.lines.length ? this.lines[this.pos] : null; }
  atEnd() { return this.pos >= this.lines.length; }
  skipBlank() {
    while (!this.atEnd()) {
      const t = this.peek().trim();
      if (t === '' || t.startsWith('#')) this.pos++;
      else break;
    }
  }
  lineIndent() {
    if (this.atEnd()) return -1;
    return this.peek().length - this.peek().trimStart().length;
  }

  readBlock(parentIndent) {
    const result = [];
    let merged = null;
    while (!this.atEnd()) {
      const indent = this.lineIndent();
      if (indent < parentIndent) break;
      const trimmed = this.peek().trim();
      if (trimmed.startsWith('- ')) {
        if (merged !== null) { result.push(merged); merged = null; }
        result.push(this.readSeqItem(indent));
      } else if (indent === parentIndent && (trimmed.startsWith('[') || trimmed.startsWith('{'))) {
        if (merged !== null) { result.push(merged); merged = null; }
        if (trimmed.startsWith('[')) result.push(this.readFlowSeq());
        else result.push(this.readFlowMap());
        this.pos++;
      } else if (indent === parentIndent && trimmed.includes(':')) {
        const ci = trimmed.indexOf(':');
        const after = trimmed.substring(ci + 1).trim();
        let entry;
        if (after === '') {
          entry = this.readMapKey(indent);
        } else if (/^\[[\s\S]*\]$/.test(after)) {
          const saved = this.lines[this.pos];
          this.lines[this.pos] = after;
          const v = this.readFlowSeq();
          this.lines[this.pos] = saved;
          entry = { [normalizeScalar(trimmed.substring(0, ci).trim())]: v };
          this.pos++;
        } else if (/^\{[\s\S]*\}$/.test(after)) {
          const saved = this.lines[this.pos];
          this.lines[this.pos] = after;
          const v = this.readFlowMap();
          this.lines[this.pos] = saved;
          entry = { [normalizeScalar(trimmed.substring(0, ci).trim())]: v };
          this.pos++;
        } else {
          let rawVal = normalizeScalar(after);
          const hi = typeof rawVal === 'string' ? rawVal.indexOf('#') : -1;
          if (hi > 0) rawVal = rawVal.substring(0, hi).trim();
          if (typeof rawVal === 'string' && rawVal.length > 1 &&
              ((rawVal[0] === '"' && rawVal[rawVal.length-1] === '"') ||
               (rawVal[0] === "'" && rawVal[rawVal.length-1] === "'"))) {
            rawVal = rawVal.slice(1, -1);
          }
          entry = { [normalizeScalar(trimmed.substring(0, ci).trim())]: rawVal };
          this.pos++;
        }
        const keys = Object.keys(entry);
        if (keys.length === 1) {
          if (merged !== null && typeof merged === 'object' && !Array.isArray(merged)) {
            Object.assign(merged, entry);
          } else {
            if (merged !== null) result.push(merged);
            merged = entry;
          }
        } else {
          if (merged !== null) { result.push(merged); merged = null; }
          result.push(entry);
        }
      } else if (indent === parentIndent) {
        if (merged !== null) { result.push(merged); merged = null; }
        result.push(this.readScalar());
      } else {
        break;
      }
    }
    if (merged !== null) result.push(merged);
    return result.length === 1 ? result[0] : result;
  }

  readMapKey(parentIndent) {
    const trimmed = this.peek().trim();
    const eq = trimmed.indexOf(':');
    const key = normalizeScalar(trimmed.substring(0, eq).trim());
    const afterOnLine = trimmed.substring(eq + 1).trim();
    if (/^[|>]/.test(afterOnLine)) {
      this.pos++;
      return { [key]: this.readBlockScalar(parentIndent) };
    }
    this.pos++;
    const afterColon = afterOnLine;
    if (afterColon !== '') {
      let v = normalizeScalar(afterColon);
      const hi = typeof v === 'string' ? v.indexOf('#') : -1;
      if (hi > 0) v = v.substring(0, hi).trim();
      if (typeof v === 'string' && v.length > 1 &&
          ((v[0] === '"' && v[v.length-1] === '"') ||
           (v[0] === "'" && v[v.length-1] === "'"))) {
        v = v.slice(1, -1);
      }
      return { [key]: v };
    }
    this.skipBlank();
    if (this.atEnd()) return { [key]: null };
    const ci = this.lineIndent();
    const ct = this.peek().trim();
    if (ci <= parentIndent) return { [key]: null };
    if (ct.startsWith('- ')) return { [key]: this.readSeqItem(ci) };
    if (ct.startsWith('[')) { const v = this.readFlowSeq(); this.pos++; return { [key]: v }; }
    if (ct.startsWith('{')) { const v = this.readFlowMap(); this.pos++; return { [key]: v }; }
    if (/^[|>]/.test(ct)) return { [key]: this.readBlockScalar(ci) };
    return { [key]: this.readBlock(ci) };
  }

  readSeqItem(parentIndent) {
    const seq = [];
    while (!this.atEnd()) {
      const indent = this.lineIndent();
      if (indent !== parentIndent) break;
      const trimmed = this.peek().trim();
      if (!trimmed.startsWith('- ')) break;
      const afterDash = trimmed.substring(2).trim();
      if (afterDash === '') {
        this.pos++;
        this.skipBlank();
        if (this.atEnd()) { seq.push(null); break; }
        const ci = this.lineIndent();
        const ct = this.peek().trim();
        if (ct.startsWith('- ')) seq.push(this.readSeqItem(ci));
        else if (ct.startsWith('[')) { seq.push(this.readFlowSeq()); this.pos++; }
        else if (ct.startsWith('{')) { seq.push(this.readFlowMap()); this.pos++; }
        else if (/^[|>]/.test(ct)) seq.push(this.readBlockScalar(ci));
        else if (ci > parentIndent) seq.push(this.readBlock(ci));
        else seq.push(null);
      } else {
        const at = afterDash.trim();
        const dci = at.indexOf(':');
        if (dci >= 0 && at.substring(dci + 1).trim() === '') {
          const dk = normalizeScalar(at.substring(0, dci).trim());
          this.pos++;
          this.skipBlank();
          if (this.atEnd()) { seq.push({ [dk]: null }); }
          else {
            const ci = this.lineIndent();
            const ct = this.peek().trim();
            if (ct.startsWith('- ')) seq.push({ [dk]: this.readSeqItem(ci) });
            else if (ct.startsWith('[')) { const v = this.readFlowSeq(); this.pos++; seq.push({ [dk]: v }); }
            else if (ct.startsWith('{')) { const v = this.readFlowMap(); this.pos++; seq.push({ [dk]: v }); }
            else if (/^[|>]/.test(ct)) seq.push({ [dk]: this.readBlockScalar(ci) });
            else if (ci > parentIndent) seq.push({ [dk]: this.readBlock(ci) });
            else seq.push({ [dk]: null });
          }
        } else if (dci >= 0) {
          const dk = normalizeScalar(at.substring(0, dci).trim());
          const dv = at.substring(dci + 1).trim();
          const nr = this.lines[this.pos + 1];
          const ni = nr ? nr.length - nr.trimStart().length : -1;
          const di = this.lines[this.pos].length - this.lines[this.pos].trimStart().length;
          const hasNested = nr && ni > di && !nr.trim().startsWith('#');
          if (hasNested) {
            this.pos++;
            const nb = this.readBlock(ni);
            const entry = { [dk]: normalizeScalar(dv) };
            if (nb && typeof nb === 'object' && !Array.isArray(nb)) Object.assign(entry, nb);
            seq.push(entry);
          } else if (/^\[[\s\S]*\]$/.test(dv)) {
            const sl = this.lines[this.pos];
            this.lines[this.pos] = dv;
            const v = this.readFlowSeq();
            this.lines[this.pos] = sl;
            seq.push({ [dk]: v });
            this.pos++;
          } else if (/^\{[\s\S]*\}$/.test(dv)) {
            const sl = this.lines[this.pos];
            this.lines[this.pos] = dv;
            const v = this.readFlowMap();
            this.lines[this.pos] = sl;
            seq.push({ [dk]: v });
            this.pos++;
          } else {
            seq.push({ [dk]: normalizeScalar(dv) });
            this.pos++;
          }
        } else {
          seq.push(normalizeScalar(afterDash));
          this.pos++;
        }
      }
    }
    return seq;
  }

  readFlowSeq() {
    const raw = this.peek().trim();
    let depth = 0, current = '', inStr = false, strChar = '';
    const chars = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inStr) {
        current += c;
        if (c === '\\' && i + 1 < raw.length) { current += raw[++i]; continue; }
        if (c === strChar) {
          if (raw[i + 1] === strChar) { current += strChar; i++; continue; }
          inStr = false;
        }
      } else if (c === '"' || c === "'") { inStr = true; strChar = c; current += c; }
      else if (c === '[' || c === '{') { depth++; if (depth > 1) current += c; }
      else if (c === ']' || c === '}') {
        depth--;
        if (depth === 0 && c === ']') { current = current.trim(); if (current) chars.push(this.parseFlowScalar(current)); current = ''; break; }
        current += c;
      } else if (c === ',' && depth === 1) {
        current = current.trim(); if (current) chars.push(this.parseFlowScalar(current));
        current = '';
      } else current += c;
    }
    if (current.trim()) chars.push(this.parseFlowScalar(current.trim()));
    return chars;
  }

  readFlowMap() {
    const raw = this.peek().trim();
    const obj = {};
    let depth = 0, current = '', inStr = false, strChar = '';
    const tokens = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inStr) {
        current += c;
        if (c === '\\' && i + 1 < raw.length) { current += raw[++i]; continue; }
        if (c === strChar) {
          if (raw[i + 1] === strChar) { current += strChar; i++; continue; }
          inStr = false;
        }
      } else if (c === '"' || c === "'") { inStr = true; strChar = c; current += c; }
      else if (c === '{' || c === '[') { depth++; if (depth > 1) current += c; }
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0 && c === '}') { current = current.trim(); if (current) tokens.push(current); current = ''; break; }
        current += c;
      } else if (c === ',' && depth === 1) {
        current = current.trim(); if (current) tokens.push(current);
        current = '';
      } else current += c;
    }
    if (current.trim()) tokens.push(current.trim());
    for (const tok of tokens) {
      const eq = tok.indexOf(':');
      if (eq < 0) continue;
      obj[this.parseFlowScalar(tok.substring(0, eq).trim())] = this.parseFlowScalar(tok.substring(eq + 1).trim());
    }
    return obj;
  }

  parseFlowScalar(raw) {
    if (!raw) return '';
    if ((raw[0] === '"' && raw[raw.length - 1] === '"') || (raw[0] === "'" && raw[raw.length - 1] === "'")) return normalizeScalar(raw.slice(1, -1));
    if (raw === '[]') return [];
    if (raw === '{}') return {};
    if (raw[0] === '[' && raw[raw.length - 1] === ']') {
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return [];
      const out = [];
      let depth = 0, cur = '', inStr = false, strChar = '';
      for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (inStr) {
          cur += c;
          if (c === '\\' && i + 1 < inner.length) { cur += inner[++i]; continue; }
          if (c === strChar) { inStr = false; }
        } else if (c === '"' || c === "'") { inStr = true; strChar = c; cur += c; }
        else if (c === '[' || c === '{') { depth++; cur += c; }
        else if (c === ']' || c === '}') { depth--; cur += c; }
        else if (c === ',' && depth === 0) { cur = cur.trim(); if (cur) out.push(this.parseFlowScalar(cur)); cur = ''; }
        else cur += c;
      }
      cur = cur.trim();
      if (cur) out.push(this.parseFlowScalar(cur));
      return out;
    }
    if (raw[0] === '{' && raw[raw.length - 1] === '}') {
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return {};
      const out = {};
      let depth = 0, cur = '', inStr = false, strChar = '';
      const toks = [];
      for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (inStr) {
          cur += c;
          if (c === '\\' && i + 1 < inner.length) { cur += inner[++i]; continue; }
          if (c === strChar) { inStr = false; }
        } else if (c === '"' || c === "'") { inStr = true; strChar = c; cur += c; }
        else if (c === '[' || c === '{') { depth++; cur += c; }
        else if (c === ']' || c === '}') { depth--; cur += c; }
        else if (c === ',' && depth === 0) { cur = cur.trim(); if (cur) toks.push(cur); cur = ''; }
        else cur += c;
      }
      cur = cur.trim();
      if (cur) toks.push(cur);
      for (const tok of toks) {
        const eq = tok.indexOf(':');
        if (eq < 0) { out.normalizeScalar = tok; continue; }
        out[this.parseFlowScalar(tok.substring(0, eq).trim())] = this.parseFlowScalar(tok.substring(eq + 1).trim());
      }
      return out;
    }
    return normalizeScalar(raw);
  }

  readBlockScalar(parentIndent) {
    const header = this.peek().trim();
    const chomp = header.includes('+') ? '+' : header.includes('-') ? '-' : '';
    const indentStr = header.replace(/[|>+-]/g, '').trim();
    const lines = [];
    this.pos++;
    let scalarIndent = indentStr ? parseInt(indentStr, 10) : null;
    if (scalarIndent === null) {
      let probe = this.pos;
      while (probe < this.lines.length) {
        const r = this.lines[probe];
        if (r.trim() === '') { probe++; continue; }
        scalarIndent = r.length - r.trimStart().length;
        break;
      }
      if (scalarIndent === null) scalarIndent = parentIndent + 1;
    }
    while (!this.atEnd()) {
      const raw = this.peek();
      const trimmed = raw.trim();
      if (trimmed === '') { this.pos++; continue; }
      const li = raw.length - raw.trimStart().length;
      if (li < scalarIndent) break;
      if (trimmed.startsWith('- ')) break;
      lines.push(raw.substring(scalarIndent));
      this.pos++;
    }
    let text = lines.join('\n');
    if (chomp === '-') text = text.replace(/\n+$/, '');
    else if (chomp === '+') { if (text) text = text + '\n'; }
    else text = text + '\n';
    return text;
  }

  readScalar() {
    if (this.atEnd()) return undefined;
    const v = this.peek().trim();
    this.pos++;
    return normalizeScalar(v);
  }

  parse() {
    this.skipBlank();
    if (this.atEnd()) return [];
    const docs = [];
    while (!this.atEnd()) {
      const first = this.peek().trim();
      if (first.startsWith('---')) { this.pos++; this.skipBlank(); }
      if (this.atEnd()) break;
      const doc = this._parseOneDoc();
      if (doc !== undefined) docs.push(doc);
      this.skipBlank();
    }
    return docs.length === 1 ? docs[0] : docs;
  }

  _parseOneDoc() {
    const firstIndent = this.lineIndent();
    const firstTrim = this.peek().trim();
    if (firstTrim.startsWith('- ')) {
      return this.readSeqItem(firstIndent);
    }
    const eq = firstTrim.indexOf(':');
    if (firstTrim.startsWith('{') && /^\{[\s\S]*\}$/.test(firstTrim)) {
      const savedLine = this.lines[this.pos];
      this.lines[this.pos] = firstTrim;
      const v = this.readFlowMap();
      this.lines[this.pos] = savedLine;
      this.pos++;
      return v;
    }
    if (eq > 0) {
      const key = normalizeScalar(firstTrim.substring(0, eq).trim());
      if (!/^(y|n|yes|no|true|false|on|off|null|~)$/i.test(key)) {
        const trimmed = this.peek().trim();
        const colonAfter = trimmed.indexOf(':');
        const afterColon = trimmed.substring(colonAfter + 1).trim();
        this.pos++;
        let value;
        if (afterColon === '') {
          this.skipBlank();
          if (this.atEnd()) value = null;
          else {
            const ci = this.lineIndent();
            const ct = this.peek().trim();
            if (/^[|>][+-]?\d*$/.test(ct)) value = this.readBlockScalar(ci);
            else if (ct.startsWith('- ')) value = this.readSeqItem(ci);
            else if (ct.startsWith('[')) { value = this.readFlowSeq(); this.pos++; }
            else if (ct.startsWith('{')) { value = this.readFlowMap(); this.pos++; }
            else if (/^[|>]/.test(ct)) value = this.readBlockScalar(ci);
            else value = this.readBlock(ci);
          }
        } else if (/^[|>][+-]?\d*$/.test(afterColon)) {
          this.pos--;
          const savedLine = this.lines[this.pos];
          this.lines[this.pos] = afterColon;
          value = this.readBlockScalar(this.lineIndent());
          this.lines[this.pos] = savedLine;
          this.pos++;
        } else if (/^\[[\s\S]*\]$/.test(afterColon)) {
          this.pos--;
          const savedLine = this.lines[this.pos];
          this.lines[this.pos] = afterColon;
          value = this.readFlowSeq();
          this.lines[this.pos] = savedLine;
          this.pos++;
        } else if (/^\{[\s\S]*\}$/.test(afterColon)) {
          this.pos--;
          const savedLine = this.lines[this.pos];
          this.lines[this.pos] = afterColon;
          value = this.readFlowMap();
          this.lines[this.pos] = savedLine;
          this.pos++;
        } else {
          let v = normalizeScalar(afterColon);
          const hi = typeof v === 'string' ? v.indexOf('#') : -1;
          if (hi > 0) v = v.substring(0, hi).trim();
          if (typeof v === 'string' && v.length > 1 &&
              ((v[0] === '"' && v[v.length-1] === '"') ||
               (v[0] === "'" && v[v.length-1] === "'"))) {
            v = v.slice(1, -1);
          }
          value = v;
        }
        return this._mergeSiblings({ [key]: value }, firstIndent);
      }
    }
    return this.readBlock(firstIndent);
  }

  _mergeSiblings(first, parentIndent) {
    while (!this.atEnd()) {
      const indent = this.lineIndent();
      if (indent !== parentIndent) break;
      let trimmed = this.peek().trim();
      if (trimmed.startsWith('#')) { this.pos++; continue; }
      if (trimmed.startsWith('- ')) {
        if (!Array.isArray(first)) {
          if (typeof first === 'object' && first !== null) first.__seq = [];
          else break;
        }
        first.__seq.push(this.readSeqItem(indent));
      } else {
        const eq = trimmed.indexOf(':');
        if (eq < 0) break;
        if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
          const key = normalizeScalar(trimmed.substring(0, eq).trim());
          const afterColon = trimmed.substring(eq + 1).trim();
          if (afterColon !== '') {
            if (/^\[[\s\S]*\]$/.test(afterColon)) {
              const savedLine = this.lines[this.pos];
              this.lines[this.pos] = afterColon;
              first[key] = this.readFlowSeq();
              this.lines[this.pos] = savedLine;
            } else if (/^\{[\s\S]*\}$/.test(afterColon)) {
              const savedLine = this.lines[this.pos];
              this.lines[this.pos] = afterColon;
              first[key] = this.readFlowMap();
              this.lines[this.pos] = savedLine;
            } else {
              let v = normalizeScalar(afterColon);
              const hi2 = typeof v === 'string' ? v.indexOf('#') : -1;
              if (hi2 > 0) v = v.substring(0, hi2).trim();
              if (typeof v === 'string' && v.length > 1 &&
                  ((v[0] === '"' && v[v.length-1] === '"') ||
                   (v[0] === "'" && v[v.length-1] === "'"))) {
                v = v.slice(1, -1);
              }
              first[key] = v;
            }
            this.pos++;
          } else {
            this.pos++;
            this.skipBlank();
            if (this.atEnd()) { first[key] = null; break; }
            const ci = this.lineIndent();
            const ct = this.peek().trim();
            if (ct.startsWith('- ')) first[key] = this.readSeqItem(ci);
            else if (ct.startsWith('[')) { first[key] = this.readFlowSeq(); this.pos++; }
            else if (ct.startsWith('{')) { first[key] = this.readFlowMap(); this.pos++; }
            else if (/^[|>]/.test(ct)) first[key] = this.readBlockScalar(ci);
            else if (ci > parentIndent) first[key] = this.readBlock(ci);
            else { first[key] = null; break; }
          }
        } else break;
      }
    }
    if (first.__seq) { const s = first.__seq; delete first.__seq; return [first, ...s]; }
    return first;
  }
}

function parse(input) {
  if (typeof input !== 'string') throw new TypeError('parse expects a string');
  return new Parser(input).parse();
}

module.exports = { parse, Parser, normalizeScalar };
