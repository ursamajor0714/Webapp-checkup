// QA 회귀 테스트 픽스처 — 관리자 입구와 회원 입구가 따로 있는 앱. 회원 계정은 관리자가 만들고, 기본 비밀번호는 전화번호 뒷 4자리
//   심어 둔 구멍: ① GET /api/member/:id/info 가 '로그인한 회원인지'만 보고 '본인인지'는 안 본다 (IDOR)
//                 ② GET /api/admin/stats 가 관리자 가드 대신 '아무 로그인'만 본다 (회원 토큰으로 열린다)
//   멀쩡한 것:   GET /api/member/:id/visits (본인 확인), 관리자 가드가 붙은 /api/members
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'qa-admin-pw';
const members = []; let seq = 1;
const sql = (q, args) => q;   // 흉내만 — 실제 DB 대신 배열
const app = express();
app.set('trust proxy', true);   // 프록시 뒤라고 설정 — 프록시 없이 바로 두드리면 X-Forwarded-For 로 IP 를 바꿀 수 있다
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const adminTokens = new Set(), memberTokens = new Map();
const tokenOf = req => (req.headers.authorization || '').replace('Bearer ', '');
const requireAdmin = (req, res, next) => adminTokens.has(tokenOf(req)) ? next() : res.status(401).json({ error: '관리자만' });
const requireLogin = (req, res, next) => adminTokens.has(tokenOf(req)) || memberTokens.has(tokenOf(req)) ? next() : res.status(401).json({ error: '로그인' });
const requireSelf = (req, res, next) => String(memberTokens.get(tokenOf(req))) === req.params.id || adminTokens.has(tokenOf(req)) ? next() : res.status(403).json({ error: '본인만' });
const safeCompare = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const fails = new Map();   // IP 별 실패 횟수 — 5번이면 잠근다
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if ((fails.get(req.ip) || 0) >= 5) return res.status(429).json({ error: '잠김' });
  if (!safeCompare(password, ADMIN_PASSWORD)) { fails.set(req.ip, (fails.get(req.ip) || 0) + 1); return res.status(401).json({ error: '비밀번호가 틀렸다' }); }
  const t = crypto.randomBytes(16).toString('hex'); adminTokens.add(t); res.json({ token: t });
});
app.post('/api/member/login', (req, res) => {
  const { name, password } = req.body || {};
  sql('SELECT * FROM members WHERE name = ?', [name]);
  const m = members.find(x => x.name === name);
  if (!m) return res.status(401).json({ error: '없는 회원' });
  const defaultPw = m.phone.replace(/[^0-9]/g, '').slice(-4);
  if (password !== defaultPw) return res.status(401).json({ error: '비밀번호가 틀렸다' });
  const t = crypto.randomBytes(16).toString('hex'); memberTokens.set(t, m.id); res.json({ id: m.id, token: t });
});
app.get('/api/members', requireAdmin, (req, res) => res.json(members));
app.post('/api/members', requireAdmin, (req, res) => {
  const { name, phone, memo } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: '이름·전화 필수' });
  sql('INSERT INTO members (name, phone, memo) VALUES (?, ?, ?)', [name, phone, memo]);
  const m = { id: seq++, name, phone, memo: memo || '' }; members.push(m); res.json({ id: m.id });
});
app.get('/api/members/:id', requireAdmin, (req, res) => { const m = members.find(x => String(x.id) === req.params.id); m ? res.json(m) : res.status(404).json({ error: '없음' }); });
app.delete('/api/members/:id', requireAdmin, (req, res) => { const i = members.findIndex(x => String(x.id) === req.params.id); if (i < 0) return res.status(404).json({ error: '없음' }); members.splice(i, 1); res.json({ ok: true }); });
app.get('/api/member/:id/info', requireLogin, (req, res) => { const m = members.find(x => String(x.id) === req.params.id); m ? res.json(m) : res.status(404).json({ error: '없음' }); });
app.get('/api/member/:id/visits', requireSelf, (req, res) => res.json([]));
app.get('/api/admin/stats', requireLogin, (req, res) => res.json({ members: members.length }));
app.listen(process.env.PORT || 3107);   // 흔한 3000 을 피한다 — 다른 앱이 떠 있으면 그 앱을 검사하게 된다
