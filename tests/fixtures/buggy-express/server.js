// QA 시험용 Express 서버 — 버그를 일부러 심었다 (tests/regression.test.js 가 QA 가 이걸 잡는지 본다)
const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 심은 버그: 비밀 기본값이 코드에 박혀 있다
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-123';

const items = [{ id: 1, name: '사과' }];
app.get('/api/health', (req, res) => res.json({ ok: true, v: JWT_SECRET.length }));
app.get('/api/items', (req, res) => res.json({ data: items }));
// 심은 버그: name 이 문자열이 아니면 .trim() 에서 죽는다 (500 + 서버 로그 TypeError)
app.post('/api/items', (req, res) => {
  const name = req.body.name.trim();
  const item = { id: items.length + 1, name };
  items.push(item);
  res.status(201).json(item);
});
app.delete('/api/items/:id', (req, res) => {
  const i = items.findIndex(x => String(x.id) === req.params.id);
  if (i < 0) return res.status(404).json({ error: '없음' });
  items.splice(i, 1);
  res.json({ ok: true });
});

// 심은 버그: 외부 API 를 제한 시간 없이 부른다 (저쪽이 느려지면 이 요청도 끝없이 기다린다)
async function exchangeRate() {
  const r = await fetch('https://api.example.com/rate?base=KRW');
  return (await r.json()).rate;
}
// 제한 시간이 있는 호출 — 잡으면 안 된다
async function ping() { return fetch('https://api.example.com/ping', { signal: AbortSignal.timeout(3000) }); }
module.exports = { exchangeRate, ping };

const port = process.env.PORT || 3999;
app.listen(port, () => console.log(`buggy-express on ${port}`));
