#!/usr/bin/env node
// 아주 작은 정적 파일 서버 — 정적 사이트를 QA 가 띄워 잴 때 쓴다 (의존성 없음)
//   node static-server.js <폴더> <포트>
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3]) || 5500;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/__health') { res.writeHead(200); return res.end('ok'); }
  let file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }        // ../ 로 밖을 못 읽게
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`정적 서버: http://localhost:${port} → ${root}`));
