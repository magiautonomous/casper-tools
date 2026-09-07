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
  check('protocol v' + (srvInfo && srvInfo.version), srvInfo && ['1.4.0'].includes(srvInfo.version));
  await rpc('notifications/initialized', {}, 2).catch(() => {});

  const list = await rpc('tools/list', {}, 3);
  const listMsg = Array.isArray(list.body) ? list.body.find(m => m.result && m.result.tools) : list.body;
  const tools = listMsg && listMsg.result ? listMsg.result.tools.map(t => t.name) : [];
  check('tools/list has 19', tools.length === 19);
  check('new tools listed', ['csv_parse', 'jwt_decode', 'markdown_to_html', 'uuid_mint'].every(t => tools.includes(t)));
  check('time tool listed', tools.includes('time_convert'));
  check('password tool listed', tools.includes('password_strength'));
  check('yaml tool listed', tools.includes('yaml_parse'));
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

  const call5 = await rpc('tools/call', { name: 'time_convert', arguments: { value: '2026-01-15T12:00:00Z', to_tz: 'America/New_York' } }, 8);
  const callMsg5 = Array.isArray(call5.body) ? call5.body.find(m => m.result) : call5.body;
  const out5 = callMsg5 && callMsg5.result && callMsg5.result.content ? callMsg5.result.content[0].text : '';
  check('time_convert over the wire', out5.includes('epoch ms 1768478400000') && out5.includes('America/New_York') && out5.includes('07:00:00'));

  const call6 = await rpc('tools/call', { name: 'password_strength', arguments: { password: 'My$tr0ng_P@ss!2024' } }, 9);
  const callMsg6 = Array.isArray(call6.body) ? call6.body.find(m => m.result) : call6.body;
  const out6 = callMsg6 && callMsg6.result && callMsg6.result.content ? callMsg6.result.content[0].text : '';
  check('password_strength over the wire', out6.includes('very_strong') && out6.includes('Entropy'));

  const call7 = await rpc('tools/call', { name: 'yaml_parse', arguments: { yaml: 'services:\n  web:\n    image: nginx:latest\n    ports:\n      - 8080:80\n  db:\n    image: postgres:15' } }, 10);
  const callMsg7 = Array.isArray(call7.body) ? call7.body.find(m => m.result) : call7.body;
  const out7 = callMsg7 && callMsg7.result && callMsg7.result.content ? callMsg7.result.content[0].text : '';
  check('yaml_parse over the wire', out7.includes('"services"') && out7.includes('nginx:latest') && out7.includes('postgres:15'));

  console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} checks FAILED`);
  process.exit(failed ? 1 : 0);
})();