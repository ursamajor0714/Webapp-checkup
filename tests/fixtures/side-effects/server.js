// QA 회귀 테스트 픽스처 — 검사가 대상에 남기는 부작용(문자 발송·데이터·로그아웃·잠금·멈춤)을 SIDEFX_OUT 에 기록한다 (실제 문자는 보내지 않는다)
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OUT = process.env.SIDEFX_OUT || path.join(require('os').tmpdir(), 'qa-sidefx-out');
fs.mkdirSync(OUT, { recursive: true });
const ev = (type, data = {}) => fs.appendFileSync(path.join(OUT, 'events.jsonl'), JSON.stringify({ t: Date.now(), type, ...data }) + '\n');
const db = { items: [], applications: [], bookings: [] };
let seq = 1;
const save = () => fs.writeFileSync(path.join(OUT, 'state.json'), JSON.stringify(db));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const tokens = new Map(); let issued = 0;
let fails = 0, lockedUntil = 0;   // 계정 하나(관리자)에 걸린 잠금 — IP 와 무관
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (Date.now() < lockedUntil) { ev('login_locked'); return res.status(423).json({ error: '잠김' }); }
  if (password === (process.env.ADMIN_PW || 'right-pw')) { fails = 0; const t = crypto.randomBytes(16).toString('hex'); tokens.set(t, ++issued); ev('login_ok', { n: issued }); return res.json({ token: t }); }
  fails++; ev('login_fail', { fails });
  if (fails >= 5) { lockedUntil = Date.now() + 10 * 60 * 1000; ev('lock'); }
  res.status(401).json({ error: `비밀번호가 틀렸다 (남은 시도: ${Math.max(0, 5 - fails)})` });
});
const auth = (req, res, next) => tokens.has((req.headers.authorization || '').replace('Bearer ', '')) ? next() : res.status(401).json({ error: 'login' });
app.post('/api/logout', auth, (req, res) => { const k = req.headers.authorization.replace('Bearer ', ''); ev('logout', { n: tokens.get(k) }); tokens.delete(k); res.json({ ok: true }); });
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/items', auth, (req, res) => res.json(db.items));
app.get('/api/items/:id', auth, (req, res) => { const x = db.items.find(i => String(i.id) === req.params.id); x ? res.json(x) : res.status(404).json({ error: 'none' }); });
app.post('/api/items', auth, (req, res) => { const { name, price } = req.body || {}; if (typeof name !== 'string' || !name) return res.status(400).json({ error: 'name' }); const x = { id: seq++, name, price }; db.items.push(x); ev('insert', { table: 'items' }); save(); res.status(201).json(x); });
app.delete('/api/items/:id', auth, (req, res) => { const n = db.items.length; db.items = db.items.filter(i => String(i.id) !== req.params.id); save(); n === db.items.length ? res.status(404).json({ error: 'none' }) : res.json({ ok: true }); });
// 공개 신청 — 이름에 위험 단어가 없지만 처리 코드가 문자를 보낸다 (CrossFit /api/applications 와 같은 꼴)
function sendSms(phone, msg) { ev('sms', { phone, msg }); return { success: true }; }
app.post('/api/applications', (req, res) => {
  const { name, phone, memo } = req.body || {};
  const x = { id: seq++, name, phone, memo }; db.applications.push(x); ev('insert', { table: 'applications' }); save();
  if (phone) sendSms(phone, `${name}님 신청이 접수됐습니다`);
  res.status(201).json(x);
});
app.get('/api/applications', auth, (req, res) => res.json(db.applications));
// 응답을 붙잡고 끝내지 않는 경로 (기본으로 켜 둔다 — HANG=0 이면 끈다)
if (process.env.HANG !== '0') app.get('/api/report', () => { ev('hang'); });
// 저장한 뒤 연결이 끊기는 경로 — 같은 요청의 첫 시도만 (FLAKY=1)
const seenBody = new Set();
app.post('/api/bookings', (req, res) => {
  const { name, phone } = req.body || {};
  db.bookings.push({ id: seq++, name, phone }); ev('insert', { table: 'bookings' }); save();
  const k = JSON.stringify(req.body);
  if (process.env.FLAKY === '1' && !seenBody.has(k)) { seenBody.add(k); return req.socket.destroy(); }
  res.status(201).json({ ok: true });
});
app.get('/api/bookings', (req, res) => res.json(db.bookings));
app.listen(process.env.PORT || 3456, () => console.log('sidefx on', process.env.PORT || 3456));
