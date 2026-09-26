#!/usr/bin/env node
// Django (템플릿) QA — 사용법은 README.md
require('../common/runner').run(__dirname).catch(e => { console.error(e); process.exit(1); });
