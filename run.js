#!/usr/bin/env node
// QA — 프로젝트 하나를 잰다. 사용법은 README.md
//   node run.js <프로젝트 이름 | 레포 폴더> [--only=b,f] [--json]
require('./common/runner').run().catch(e => { console.error(e.message); process.exit(1); });
