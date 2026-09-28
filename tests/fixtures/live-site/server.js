// QA 회귀 테스트 픽스처 — 배포 주소 검사(--live)용 '레포 쪽 코드'. 이 파일은 켜지 않는다 (경로·파일을 찾는 데만 쓴다)
//   실제로 떠 있는 '배포본'은 테스트 안의 작은 http 서버가 흉내 낸다 — 옛 코드가 떠 있어 가드가 빠진 상태
const express = require('express');
const path = require('path');
const app = express();
const requireLogin = (req, res, next) => (req.headers.authorization ? next() : res.status(401).end());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/notices', (req, res) => res.json([]));
app.get('/api/members', requireLogin, (req, res) => res.json([]));
app.get('/api/orders/:id', requireLogin, (req, res) => res.json({}));
app.listen(3000);
