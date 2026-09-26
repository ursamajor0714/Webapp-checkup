// ============================================================
// 도구 자기 점검 — 이 점검 도구가 스스로 썩지 않게
//
// 측정 도구가 거짓으로 실패하면 진짜 결함보다 나쁘다. 사람이 결과를 안 믿게 되기 때문이다.
// 실제로 두 번 겪었다.
//   · 프로브에 '2026-09-20' 같은 날짜를 박아 뒀더니 그날이 지나자 홀딩 검사가 깨졌다 (제품은 멀쩡)
//   · 검사가 만든 회원을 지우면서 락커 이력을 안 치워, 없는 회원의 매출 60,000원을 DB에 남겼다
// ============================================================
const fs = require('fs');
const path = require('path');

const SECTION_DIRS = ['front', 'front-api', 'api', 'security'].map(d => path.join(__dirname, d));

function probeFiles() {
  return SECTION_DIRS.flatMap(d => fs.readdirSync(d).filter(f => f.endsWith('.js')).map(f => path.join(d, f)));
}

// ── 1. 고정 날짜가 박혀 있는가
function hardcodedDates() {
  const hits = [];
  for (const f of probeFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;                    // 주석은 설명이라 괜찮다
      // 말일·윤년 계산처럼 날짜가 고정이어야 의미가 있는 검사도 있다.
      // 그런 줄에는 '고정날짜' 라고 적어 두기로 한다 — 의도를 코드에 남겨야 나중에 헷갈리지 않는다.
      if (/고정날짜/.test(line)) return;
      for (const m of line.matchAll(/'(\d{4}-\d{2}(?:-\d{2})?)'/g)) {
        // 굳어도 되는 날짜가 있다.
        //   · 생년월일(1990-05-05) — 시간이 지나도 의미가 안 변한다
        //   · 1999-01 처럼 '일부러 아무것도 없는 과거' — 빈 결과를 보려는 값이다
        // 위험한 것은 '지금 근처' 날짜다. 오늘이 지나가면 미래가 과거가 되어 검사가 거짓으로 깨진다.
        const year = Number(m[1].slice(0, 4));
        const nowYear = new Date().getFullYear();
        if (Math.abs(year - nowYear) > 1) continue;
        // 2026-02-31 처럼 달력에 없는 날짜는 '잘못된 값' 을 넣어 보려고 일부러 쓰는 것이다
        const parts = m[1].split('-').map(Number);
        if (parts.length === 3) {
          const d = new Date(parts[0], parts[1] - 1, parts[2]);
          if (d.getDate() !== parts[2] || d.getMonth() !== parts[1] - 1) continue;
        }
        if (parts.length === 2 && (parts[1] < 1 || parts[1] > 12)) continue;
        hits.push(`${path.basename(f)}:${i + 1} — '${m[1]}' (kstDay() 를 쓰세요)`);
      }
    });
  }
  return hits;
}

// ── 2. 검사가 만든 데이터를 치웠는가
// 이름에 QA 를 붙이기로 약속했으므로, 끝난 뒤 그 이름이 남아 있으면 안 치운 것이다.
async function leftovers(ctx) {
  const notes = [];
  const members = (await ctx.call('/api/members')).body;
  if (Array.isArray(members)) {
    const stray = members.filter(m => /^QA|시험|확인$/.test(m.name) || m.name.startsWith('QA'));
    for (const m of stray) notes.push(`회원 '${m.name}' 이 남아 있다`);
  }
  const contracts = (await ctx.call('/api/contracts')).body;
  if (Array.isArray(contracts)) {
    for (const c of contracts.filter(c => c.name.startsWith('QA'))) notes.push(`계약서 '${c.name}' 이 남아 있다`);
  }
  const led = (await ctx.call('/api/ledger')).body;
  if (led && (led.income || led.expense)) {
    for (const r of [...(led.income || []), ...(led.expense || [])]) {
      if (String(r.detail || '').startsWith('QA')) notes.push(`가계부 '${r.detail}' 이 남아 있다`);
    }
  }
  // 고아가 새로 생겼는지 (검사가 회원을 지우면서 딸린 기록을 흘렸을 때)
  const orphan = ctx.sql(`select count(*) from locker_history h
    where h.member_id is not null and not exists (select 1 from members m where m.id=h.member_id)`);
  if (orphan !== null && Number(orphan) > 0) {
    notes.push(`부모 없는 락커 이력 ${orphan}건이 남았다 — 검사가 회원을 지우면서 흘렸다`);
  }
  return notes;
}

// ── 3. 프로브가 형식을 지키는가
function shape() {
  const bad = [];
  for (const f of probeFiles()) {
    const mod = require(f);
    for (const k of ['id', 'name', 'weight', 'run']) {
      if (mod[k] === undefined) bad.push(`${path.basename(f)} — ${k} 가 없다`);
    }
    if (typeof mod.run !== 'function') bad.push(`${path.basename(f)} — run 이 함수가 아니다`);
  }
  return bad;
}

async function run(ctx) {
  const dates = hardcodedDates();
  const shapes = shape();
  const left = await leftovers(ctx);
  return {
    items: [
      { label: '프로브에 고정 날짜가 없다', ok: dates.length === 0, notes: dates.slice(0, 8) },
      { label: '프로브 형식이 맞다',        ok: shapes.length === 0, notes: shapes },
      { label: '검사가 만든 데이터를 치웠다', ok: left.length === 0,  notes: left.slice(0, 8) },
    ],
  };
}

module.exports = { run };
