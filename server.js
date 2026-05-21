const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;
const HF_TOKEN = process.env.HF_TOKEN || '';

const SPACES = [
  { name: 'IDM-VTON', host: 'yisol-idm-vton.hf.space' },
  { name: 'LEFFA',    host: 'franciszzj-leffa.hf.space' },
  { name: 'CatVTON',  host: 'zhengchong-catvton.hf.space' },
  { name: 'VTON-v2',  host: 'kadirnar-idm-vton-v2.hf.space' },
  { name: 'OOTDiff',  host: 'levihsu-ootdiffusion.hf.space' },
  { name: 'Kolors',   host: 'kwai-kolors-kolors-virtual-try-on.hf.space' }
];

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function jsonRes(res, status, obj) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function proxyReq(opts, body, ms) {
  return new Promise(function(resolve) {
    const hdrs = Object.assign({}, opts.headers);
    if (HF_TOKEN) hdrs['Authorization'] = 'Bearer ' + HF_TOKEN;
    const req = https.request(Object.assign({}, opts, { headers: hdrs }), function(r) {
      const chunks = [];
      r.on('data', function(c) { chunks.push(c); });
      r.on('end', function() {
        resolve({ status: r.statusCode, body: Buffer.concat(chunks), headers: r.headers });
      });
    });
    req.on('error', function(e) { resolve({ status: 0, body: Buffer.from(e.message), headers: {} }); });
    const t = setTimeout(function() { req.destroy(); resolve({ status: 0, body: Buffer.from('timeout'), headers: {} }); }, ms || 30000);
    req.on('response', function() { clearTimeout(t); });
    if (body && body.length) req.write(body);
    req.end();
  });
}

function proxySSE(req, res, host, path) {
  cors(res);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  const h = { 'Accept': 'text/event-stream' };
  if (HF_TOKEN) h['Authorization'] = 'Bearer ' + HF_TOKEN;
  const pr = https.request({ host: host, path: path, method: 'GET', headers: h }, function(r) {
    r.on('data', function(c) { res.write(c); });
    r.on('end', function() { res.end(); });
  });
  pr.on('error', function(e) {
    res.write('data: ' + JSON.stringify({ msg: 'error', error: e.message }) + '\n\n');
    res.end();
  });
  req.on('close', function() { pr.destroy(); });
  pr.end();
}

async function handleProxy(req, res, pu) {
  const parts = pu.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'proxy' || parts.length < 2) return jsonRes(res, 400, { error: 'bad path' });
  const idx = parseInt(parts[1], 10);
  if (isNaN(idx) || idx < 0 || idx >= SPACES.length) return jsonRes(res, 400, { error: 'bad index 0-5' });
  const sp = SPACES[idx];
  const sub = '/' + parts.slice(2).join('/') + (pu.search || '');
  if (sub.startsWith('/queue/data')) return proxySSE(req, res, sp.host, sub);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const ct = req.headers['content-type'] || '';
  const r = await proxyReq(
    { host: sp.host, path: sub, method: req.method, headers: { 'Content-Type': ct, 'Content-Length': raw.length } },
    raw, 120000
  );
  cors(res);
  res.writeHead(r.status || 502, { 'Content-Type': r.headers['content-type'] || 'application/octet-stream' });
  res.end(r.body);
}

const server = http.createServer(async function(req, res) {
  const pu = url.parse(req.url, true);
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    return res.end();
  }
  if (pu.pathname === '/health') {
    return jsonRes(res, 200, {
      status: 'ok',
      token: HF_TOKEN ? 'SET OK' : 'MISSING - set HF_TOKEN',
      spaces: SPACES.map(function(s, i) { return i + ':' + s.name; })
    });
  }
  if (pu.pathname.startsWith('/proxy/')) return handleProxy(req, res, pu);
  jsonRes(res, 404, { error: 'use /health or /proxy/INDEX/...' });
});

server.listen(PORT, function() {
  console.log('');
  console.log('================================');
  console.log(' COTTON KING SERVER RUNNING!');
  console.log(' http://localhost:' + PORT + '/health');
  console.log(' Token: ' + (HF_TOKEN ? 'SET OK' : 'MISSING!'));
  console.log('================================');
  console.log('');
});
