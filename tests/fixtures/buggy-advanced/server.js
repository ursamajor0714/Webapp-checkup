// QA 회귀 테스트 픽스처 — 고급·전문가 검사가 잡아야 할 결함을 일부러 심은 서버 (쿠키 세션)
//   권한 상승(가입 때 role 을 그대로 저장) · 동시 수정 유실(읽고-기다리고-쓰기) · CSRF 확인 없음 · 세션 고정(로그인해도 세션 id 그대로)
//   오픈 리다이렉트(?next=) · 화면이 늦게 밀리는 레이아웃(CLS) · 요청 제한 없음 · HSTS 없음
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const users = [{ id: 1, username: 'owner1', password: 'Right-pw1', role: 'user' }];
const sessions = new Map();   // sid → userId | null
const sidOf = req => ((req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/) || [])[1];
// 세션은 처음 들어올 때 만든다 — 로그인해도 같은 sid 를 그대로 쓴다 (세션 고정)
app.use((req, res, next) => { let sid = sidOf(req); if (!sid || !sessions.has(sid)) { sid = crypto.randomBytes(12).toString('hex'); sessions.set(sid, null); res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`); } req.sid = sid; next(); });
const me = req => users.find(u => u.id === sessions.get(req.sid));
const auth = (req, res, next) => (me(req) ? next() : res.status(401).json({ error: 'login' }));

app.post('/api/signup', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'invalid' });
  if (users.some(u => u.username === username)) return res.status(409).json({ error: 'dup' });
  const u = { id: users.length + 1, role: 'user', ...req.body };   // 권한 상승 — 본문의 role 을 그대로 저장한다
  users.push(u);
  res.status(201).json({ id: u.id, username: u.username, role: u.role });
});
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = users.find(x => x.username === username && x.password === password);
  if (!u) return res.status(401).json({ error: '틀렸다' });
  sessions.set(req.sid, u.id);   // sid 를 새로 만들지 않는다
  res.json({ ok: true });
});
app.post('/api/logout', auth, (req, res) => { sessions.set(req.sid, null); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => { const u = me(req); res.json({ id: u.id, username: u.username, role: u.role }); });

// 메모 — 수정은 '읽고 → 잠깐 기다리고 → 읽은 것에 덮어쓰기' 라서 동시에 고치면 한쪽이 사라진다
const notes = []; let seq = 1;
app.get('/api/notes', auth, (req, res) => res.json(notes));
app.post('/api/notes', auth, (req, res) => { const { title, body } = req.body || {}; if (typeof title !== 'string' || !title) return res.status(400).json({ error: 'title' }); const n = { id: seq++, title, body: body || '' }; notes.push(n); res.status(201).json(n); });
app.get('/api/notes/:id', auth, (req, res) => { const n = notes.find(x => String(x.id) === req.params.id); n ? res.json(n) : res.status(404).json({ error: 'none' }); });
app.patch('/api/notes/:id', auth, async (req, res) => {
  const n = notes.find(x => String(x.id) === req.params.id); if (!n) return res.status(404).json({ error: 'none' });
  const snapshot = { ...n };
  await new Promise(r => setTimeout(r, 150));
  Object.assign(n, snapshot, req.body);   // 동시 수정 유실
  res.json(n);
});
app.delete('/api/notes/:id', auth, (req, res) => { const i = notes.findIndex(x => String(x.id) === req.params.id); if (i < 0) return res.status(404).json({ error: 'none' }); notes.splice(i, 1); res.json({ ok: true }); });

// 오픈 리다이렉트
app.get('/go', (req, res) => res.redirect(req.query.next || '/'));
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 3457);
