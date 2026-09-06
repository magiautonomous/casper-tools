#!/usr/bin/env node
// End-to-end probe: MCP initialize + tools/call over the live Streamable HTTP endpoint.
const BASE = process.argv[2] || 'http://127.0.0.1:3000/mcp';
let failed = 0;
const check = (label, ok) => { console.log((ok ? '  ok ' : '  FAIL ') + label); if (!ok) failed++; };

async function rpc(method, params, id) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'X-Probe': 'magi-self' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const ct = res.headers.get('content-type') || '';
  let body;
  if (ct.includes('text/event-stream')) {
    const raw = await res.text();
    const jsons = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean);
    body = jsons.map(j => JSON.parse(j));
  } else {
    body = await res.json();
  }
  return { status: res.status, body };
}

(async () => {
  console.log('Probing ' + BASE);
  const init = await rpc('initialize', { protocolVersion: '2026-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1.0' } }, 1);
  const msg = Array.isArray(init.body) ? init.body[0] : init.body;
  const srvInfo = msg.result && msg.result.serverInfo;
  check('initialize ok', init.status === 200 && srvInfo && srvInfo.name === 'casper-tools');
  check('protocol v' + (srvInfo && srvInfo.version), srvInfo && ['1.2.0'].includes(srvInfo.version));
  await rpc('notifications/initialized', {}, 2).catch(() => {});

  const list = await rpc('tools/list', {}, 3);
  const listMsg = Array.isArray(list.body) ? list.body.find(m => m.result && m.result.tools) : list.body;
  const tools = listMsg && listMsg.result ? listMsg.result.tools.map(t => t.name) : [];
  check('tools/list has 16', tools.length === 16);
  check('new tools listed', ['csv_parse', 'jwt_decode', 'markdown_to_html', 'uuid_mint'].every(t => tools.includes(t)));
  check('semver tools listed', ['semver_compare', 'semver_satisfies', 'semver_bump', 'semver_max'].every(t => tools.includes(t)));

  const call = await rpc('tools/call', { name: 'csv_parse', arguments: { csv: 'a,b\n1,2\n3,4', delimiter: 'auto', has_header: true } }, 4);
  const callMsg = Array.isArray(call.body) ? call.body.find(m => m.result) : call.body;
  const out = callMsg && callMsg.result && callMsg.result.content ? callMsg.result.content[0].text : '';
  check('csv_parse returns rows', out.includes('Data rows: 2'));
  check('csv_parse structured', out.includes('Columns (2): a, b'));

  const call2 = await rpc('tools/call', { name: 'uuid_mint', arguments: { kind: 'uuid', count: 2 } }, 5);
  const callMsg2 = Array.isArray(call2.body) ? call2.body.find(m => m.result) : call2.body;
  const out2 = callMsg2 && callMsg2.result && callMsg2.result.content ? callMsg2.result.content[0].text : '';
  check('uuid_mint returns uuids', (out2.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g) || []).length === 2);

  const call3 = await rpc('tools/call', { name: 'semver_compare', arguments: { a: '1.10.0', b: '1.9.9' } }, 6);
  const callMsg3 = Array.isArray(call3.body) ? call3.body.find(m => m.result) : call3.body;
  const out3 = callMsg3 && callMsg3.result && callMsg3.result.content ? callMsg3.result.content[0].text : '';
  check('semver_compare over the wire', out3.includes('compare(1.10.0, 1.9.9) = 1') && out3.includes('1.10.0 > 1.9.9'));

  const call4 = await rpc('tools/call', { name: 'semver_max', arguments: { range: '^1.0.0', versions: '1.4.1, 1.5.0-beta.1, 1.6.0' } }, 7);
  const callMsg4 = Array.isArray(call4.body) ? call4.body.find(m => m.result) : call4.body;
  const out4 = callMsg4 && callMsg4.result && callMsg4.result.content ? callMsg4.result.content[0].text : '';
  check('semver_max over the wire', out4.includes('MAX satisfying') && out4.includes('1.6.0'));

  console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} checks FAILED`);
  process.exit(failed ? 1 : 0);
})();