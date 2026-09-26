#!/usr/bin/env node
// 순수 JS 정적 페이지 QA — 사용법은 README.md
require('../common/runner').run(__dirname).catch(e => { console.error(e); process.exit(1); });
