// ============================================================
// QA 러너의 공통 부품
//
// 용어를 먼저 못박는다. 이 둘을 섞으면 숫자가 의미를 잃는다.
//
//   모집단(universe) : 그 영역에서 "검사할 수 있는 대상"의 전체 수.
//                      예) 서버가 가진 API 경로 전부, 화면이 참조하는 DOM id 전부.
//   스캔(scanned)    : 그중 이번 실행이 실제로 들여다본 수.
//   스캔률           : scanned / universe — "얼마나 넓게 봤나"
//   합격(passed)     : 들여다본 것 중 문제가 없던 수.
//   합격률           : passed / scanned — "본 것 중 얼마나 멀쩡한가"
//
// 스캔률이 높아도 합격률이 낮으면 나쁜 제품이고,
// 합격률이 100%여도 스캔률이 10%면 그냥 안 본 것이다. 둘 다 내야 한다.
// ============================================================
// 검사 하나의 결과를 만드는 도우미
//
// passed  : 확실히 통과
// warned  : 기계가 확신할 수 없어 사람이 봐야 하는 것 (불합격으로 세지 않는다)
// failed  : 확실한 결함 = scanned - passed - warned
//
// 추정에 불과한 것을 불합격으로 세면 점수가 거짓이 된다. 정직하게 나눠 둔다.
//
// items (선택) : 본 것 하나하나의 O/X — 화면(ui.js)이 목록으로 보여 준다.
//               [{ name, ok: true|false|null(확인 필요), detail }]
function check(name, { universe, scanned, passed, notes = [], warned = 0, warnNotes = [], skipped = 0, items }) {
  return { name, universe, scanned, passed, warned,
           failed: Math.max(0, scanned - passed - warned), skipped, notes, warnNotes, ...(items ? { items } : {}) };
}

// O/X 목록으로 check 를 만든다 — 합격·불합격·확인 필요 수를 목록에서 센다
function checkItems(name, items, { universe } = {}) {
  const passed = items.filter(i => i.ok === true).length;
  const warned = items.filter(i => i.ok === null).length;
  return check(name, {
    universe: universe ?? items.length, scanned: items.length, passed, warned, items,
    notes: items.filter(i => i.ok === false).map(i => `${i.name} — ${i.detail}`),
    warnNotes: items.filter(i => i.ok === null).map(i => `${i.name} — ${i.detail}`),
  });
}

module.exports = { check, checkItems };
