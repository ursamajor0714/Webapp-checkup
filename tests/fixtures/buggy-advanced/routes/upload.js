// 파일 업로드 — 종류·크기 제한 없이 받는다 (전문가 수준 정적 검사용, 서버에 끼우지 않은 라우터)
const express = require('express');
const multer = require('multer');
const router = express.Router();
const upload = multer({ dest: 'uploads/' });
router.post('/api/upload', upload.single('file'), (req, res) => res.json({ path: req.file.path }));
module.exports = router;
