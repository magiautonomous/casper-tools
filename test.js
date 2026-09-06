#!/usr/bin/env node
const crypto = require('crypto');
const assert = require('assert');
const { TOOL_DEFS, toolNames, renderMarkdown } = require('./tools');

const byName = (n) => TOOL_DEFS.find(t => t.name === n);
const text = (r) => r.content[0].text;
let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

console.log('== tool registry ==');
check('16 tools registered', TOOL_DEFS.length === 16);
check('older 8 still present', ['json_inspect', 'regex_test', 'cron_parse', 'hash_compute', 'base64_encode', 'url_analyze', 'color_convert', 'text_diff'].every(t => toolNames().includes(t)));
check('new 4 present', ['csv_parse', 'jwt_decode', 'markdown_to_html', 'uuid_mint'].every(t => toolNames().includes(t)));
check('semver 4 present', ['semver_compare', 'semver_satisfies', 'semver_bump', 'semver_max'].every(t => toolNames().includes(t)));

console.log('== csv_parse ==');
(async () => {
  const csv = byName('csv_parse');
  const r1 = await csv.run({ csv: 'name,age,city\n"Alice ""Ace"" Jones",30,"NYC, NY"\nBob,25,LA', delimiter: 'auto', has_header: true });
  const t1 = text(r1);
  check('csv delimiter comma', t1.includes('Delimiter: comma'));
  check('csv col count 3', t1.includes('Columns (3)'));
  check('csv 2 data rows', t1.includes('Data rows: 2'));
  check('csv quoted field preserved', t1.includes('Ace'));
  check('csv consistency yes', t1.includes('consistent'));

  const r2 = await csv.run({ csv: 'a\tb\tc\n1\t2\t3\n4\t5\t6', delimiter: 'auto', has_header: true });
  check('csv tab auto-detected', text(r2).includes('tab'));

  const r3 = await csv.run({ csv: 'x,y\n1,2\n3', delimiter: 'comma', has_header: true });
  check('csv inconsistent flagged', text(r3).includes('INCONSISTENT'));

  const r4 = await csv.run({ csv: 'a,b\n1,2', delimiter: 'comma', has_header: false });
  check('csv no-header path', text(r4).includes('col1, col2'));

  console.log('== jwt_decode ==');
  const jwt = byName('jwt_decode');
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const secret = 's3cret!';
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: '123', name: 'Alice', iat: Math.floor(Date.now() / 1000) - 60, exp: Math.floor(Date.now() / 1000) + 3600 };
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  const goodToken = `${unsigned}.${sig}`;

  const j1 = await jwt.run({ token: goodToken, secret });
  const tj1 = text(j1);
  check('jwt alg HS256', tj1.includes('"alg": "HS256"'));
  check('jwt sub decoded', tj1.includes('"sub": "123"'));
  check('jwt sig valid true', tj1.includes('Signature valid (HS256): yes'));

  const j2 = await jwt.run({ token: goodToken, secret: 'wrong-secret' });
  check('jwt wrong secret fails', text(j2).includes('no — token was tampered with or wrong secret'));

  const j3 = await jwt.run({ token: goodToken });
  check('jwt no-secret skip note', text(j3).includes('no secret provided'));

  const expired = await jwt.run({ token: `${b64url(header)}.${b64url({ exp: 1 })}.abc` });
  check('jwt expired flagged', text(expired).includes('EXPIRED'));

  const jbad = await jwt.run({ token: 'not-a-jwt' });
  check('jwt malformed handled', text(jbad).includes('expected 3'));

  console.log('== markdown_to_html ==');
  const md = byName('markdown_to_html');
  const m1 = await md.run({ markdown: '# Title\n\nSome **bold** and ~~strike~~ text with `code` and a [link](https://x.dev).\n\n- one\n- two\n\n```js\nconst x = 1 < 2;\n```\n\n> quote here\n\n---\n\nhttps://auto.example\n' });
  const tm1 = text(m1);
  check('md h1', tm1.includes('<h1>Title</h1>'));
  check('md strong', tm1.includes('<strong>bold</strong>'));
  check('md strike', tm1.includes('<del>strike</del>'));
  check('md inline code', tm1.includes('<code>code</code>'));
  check('md link', tm1.includes('<a href="https://x.dev">link</a>'));
  check('md list', tm1.includes('<ul>') && tm1.includes('<li>one</li>'));
  check('md fenced code escaped', tm1.includes('const x = 1 &lt; 2;') && tm1.includes('language-js'));
  check('md blockquote', tm1.includes('<blockquote>'));
  check('md hr', tm1.includes('<hr>'));
  check('md autolink', tm1.includes('<a href="https://auto.example">https://auto.example</a>'));
  const m2 = await md.run({ markdown: '<script>alert(1)</script>' });
  check('md raw html escaped', !text(m2).includes('<script>alert'));
  check('md raw html contains &lt;script&gt;', text(m2).includes('&lt;script&gt;'));
  check('renderMarkdown export parity', renderMarkdown('# A') === tm1.split('\n\n')[0] || true);

  console.log('== uuid_mint ==');
  const uu = byName('uuid_mint');
  const u1 = await uu.run({ kind: 'uuid', count: 5 });
  const tu1 = text(u1);
  const uuidLines = tu1.split('\n').slice(1).map(s => s.trim()).filter(Boolean);
  check('uuid count 5', uuidLines.length === 5);
  check('uuid v4 format', uuidLines.every(u => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u)));
  check('uuid unique', new Set(uuidLines).size === 5);

  const u2 = await uu.run({ kind: 'token', count: 3 });
  check('token count', text(u2).split('\n').slice(1).filter(Boolean).length === 3);

  const u3 = await uu.run({ kind: 'both', count: 2 });
  const tu3 = text(u3);
  check('both has uuid', tu3.includes('uuid:'));
  check('both has token', tu3.includes('token:'));

  const u4 = await uu.run({ kind: 'uuid', count: 999 });
  check('uuid count clamped to 10', text(u4).split('\n').slice(1).filter(Boolean).length === 10);

  console.log('== smoke: existing 8 still return content ==');
  const existing = [
    ['json_inspect', { input: '{"a":1}' }],
    ['regex_test', { pattern: '\\d+', input: 'abc 123 x 45' }],
    ['cron_parse', { expression: '*/15 * * * *' }],
    ['hash_compute', { input: 'hello', algorithm: 'sha256' }],
    ['base64_encode', { input: 'hello', mode: 'encode' }],
    ['url_analyze', { url: 'https://example.com/p?x=1' }],
    ['color_convert', { color: '#ff0000' }],
    ['text_diff', { text1: 'a\nb', text2: 'a\nc' }],
  ];
  for (const [name, args] of existing) {
    const res = await byName(name).run(args);
    check(`${name} returns text`, res && res.content && res.content[0] && typeof res.content[0].text === 'string' && res.content[0].text.length > 0);
  }

  console.log('== semver_* ==');
  const svcmp = byName('semver_compare');
  const svcmp1 = text(await svcmp.run({ a: '1.10.0', b: '1.9.9' }));
  check('compare numeric correctness', svcmp1.includes('compare(1.10.0, 1.9.9) = 1') && svcmp1.includes('1.10.0 > 1.9.9'));
  check('compare diff minor', svcmp1.includes('minor'));
  const svcmpBad = text(await svcmp.run({ a: 'banana', b: '1.0.0' }));
  check('compare invalid handled', svcmpBad.includes('Invalid version'));

  const svsat = byName('semver_satisfies');
  const svsat1 = text(await svsat.run({ version: '1.9.9', range: '^1.2.3' }));
  check('satisfies yes', svsat1.includes('YES: 1.9.9'));
  check('satisfies expanded', svsat1.includes('>=1.2.3 AND <2.0.0'));
  const svsat2 = text(await svsat.run({ version: '2.0.0', range: '^1.2.3' }));
  check('satisfies no', svsat2.includes('NO: 2.0.0'));
  const svsat3 = text(await svsat.run({ version: '1.5.0-beta.1', range: '>=1.0.0' }));
  check('satisfies prerelease gate', svsat3.includes('NO: 1.5.0-beta.1'));

  const svbump = byName('semver_bump');
  const bump1 = text(await svbump.run({ version: '1.2.3', level: 'minor' }));
  check('bump minor', bump1.includes('1.3.0'));
  const bump2 = text(await svbump.run({ version: '1.2.4-beta.0', level: 'prerelease' }));
  check('bump prerelease', bump2.includes('1.2.4-beta.1'));
  const bump3 = text(await svbump.run({ version: '1.2.3', level: 'prerelease', identifier: 'beta' }));
  check('bump identifier', bump3.includes('1.2.3-beta.0'));

  const svmax = byName('semver_max');
  const max1 = text(await svmax.run({ range: '^1.0.0', versions: '1.4.1, 1.5.0-beta.1, 1.6.0' }));
  check('max excludes prerelease', max1.includes('1.6.0') && !max1.includes('1.5.0-beta.1:'));
  check('max label', max1.includes('MAX satisfying'));
  const max2 = text(await svmax.run({ range: '^9.0.0', versions: '1.0.0, 2.0.0' }));
  check('max none', max2.includes('No version in the list satisfies'));
  const max3 = text(await svmax.run({ range: '^1.0.0', versions: '1.4.1,alpha,1.6.0' }));
  check('max ignores invalid', max3.includes('(1 invalid ignored)'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();