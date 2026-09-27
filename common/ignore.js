// 무시 목록 — "의도된 것·오탐" 이라고 사람이 표시한 문제는 다음 검사부터 통과로 센다 (이유와 함께 남는다)
//   대상 레포의 .qa-ignore.json 에 저장한다 → 팀원·CI 가 같은 기준을 쓴다 (깃에 올려도 된다, 비밀이 없다)
//   { "version": 1, "items": [{ "key", "area", "check", "item", "reason", "at" }] }
//   열쇠 = 영역 + 검사 이름 + 항목 이름 (숫자는 지운다 — 매번 달라지는 id·시간·횟수에 흔들리지 않게)
const fs = require('fs');
const path = require('path');

const FILE = '.qa-ignore.json';
const norm = s => String(s || '').replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim().slice(0, 200);
const findingKey = (area, check, item) => `${area}|${norm(check)}|${norm(item)}`;

function load(root) {
  try { const j = JSON.parse(fs.readFileSync(path.join(root, FILE), 'utf8')); return Array.isArray(j.items) ? j.items : []; } catch { return []; }
}
function save(root, items) {
  fs.writeFileSync(path.join(root, FILE), JSON.stringify({ version: 1, note: 'QA 무시 목록 — 의도된 것·오탐으로 표시한 문제. 지우면 다시 검사한다', items }, null, 2) + '\n');
}
function add(root, { area, check, item, reason }) {
  const items = load(root);
  const key = findingKey(area, check, item);
  if (!items.some(i => i.key === key)) items.push({ key, area, check: String(check).slice(0, 200), item: String(item).slice(0, 300), reason: String(reason || '').slice(0, 300), at: new Date().toISOString().slice(0, 10) });
  save(root, items);
  return items;
}
function remove(root, key) { const items = load(root).filter(i => i.key !== key); save(root, items); return items; }

// 영역 결과 하나에 적용 — 맞는 X·△ 를 '무시함' 통과로 바꾸고 수를 다시 센다
function apply(result, ignores) {
  if (!ignores || !ignores.length || !result.checks) return 0;
  const map = new Map(ignores.map(i => [i.key, i]));
  let n = 0;
  for (const c of result.checks) {
    if (c.items) {
      for (const it of c.items) {
        if (it.ok === true) continue;
        const hit = map.get(findingKey(result.id, c.name, it.name)) || map.get(findingKey(result.id, c.name, `${it.name} — ${it.detail}`));
        if (!hit) continue;
        it.ignored = hit.reason || '무시함'; it.was = it.ok; it.ok = true; it.detail = `무시함 (${hit.reason || '이유 없음'}) — ${it.detail || ''}`; n++;
      }
      c.passed = c.items.filter(i => i.ok === true).length; c.warned = c.items.filter(i => i.ok === null).length; c.failed = c.items.filter(i => i.ok === false).length;
      c.notes = c.items.filter(i => i.ok === false).map(i => `${i.name} — ${i.detail}`); c.warnNotes = c.items.filter(i => i.ok === null).map(i => `${i.name} — ${i.detail}`);
    } else {
      const keep = (c.notes || []).filter(nt => !map.has(findingKey(result.id, c.name, nt)));
      const drop = (c.notes || []).length - keep.length;
      const keepW = (c.warnNotes || []).filter(nt => !map.has(findingKey(result.id, c.name, nt)));
      const dropW = (c.warnNotes || []).length - keepW.length;
      if (drop || dropW) {
        // 목록 없는 검사는 문제 수와 메모 수가 딱 맞지 않을 수 있다 — 무시한 만큼만 옮긴다
        const moveF = Math.min(drop, c.failed), moveW = Math.min(dropW, c.warned);
        c.failed -= moveF; c.warned -= moveW; c.passed += moveF + moveW; c.notes = keep; c.warnNotes = keepW; c.ignored = (c.ignored || 0) + drop + dropW; n += drop + dropW;
      }
    }
  }
  const sum = k => result.checks.reduce((s, c) => s + (c[k] || 0), 0);
  result.passed = sum('passed'); result.warned = sum('warned'); result.failed = sum('failed');
  result.passRate = (result.scanned - result.warned) ? result.passed / (result.scanned - result.warned) : 1;
  result.ignored = n;
  return n;
}

module.exports = { FILE, findingKey, load, add, remove, apply };
