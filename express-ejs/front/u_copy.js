// U. 화면 문구 — 사용자가 읽는 글이 말이 되는가
// 기능이 맞아도 "'임대료'은 쓸 수 없습니다" 처럼 나오면 만든 티가 난다.
const { check } = require('../../common/core');

module.exports = {
  id: 'U', name: '화면 문구·한국어', weight: 3,
  async run(ctx) {
    const checks = [];
    const views = ctx.files(['frontend/views'], ['.ejs']);
    const scripts = ctx.files(['frontend/public/js'], ['.js']);
    const all = [...views, ...scripts];

    // ── 1. 조사(은/는, 이/가, 을/를)를 값 뒤에 그냥 붙이지 않았는가
    //    끝 글자의 받침에 따라 달라지므로 변수 뒤에 고정 조사를 붙이면 반드시 틀린다
    let interps = 0; const josa = [];
    for (const f of all) {
      const src = ctx.readAbs(f);
      for (const m of src.matchAll(/\$\{[^}]{1,60}\}(은|는|이|가|을|를|와|과|으로|로)\s/g)) {
        interps++;
        josa.push(`${ctx.rel(f)}: ...${m[0].trim()} — 받침에 따라 조사가 달라진다`);
      }
      interps += (src.match(/\$\{[^}]{1,60}\}/g) || []).length;
    }
    checks.push(check('변수 뒤에 조사를 그대로 붙이지 않았다', {
      universe: interps, scanned: interps, passed: interps - josa.length, notes: josa.slice(0, 20),
    }));

    // ── 2. 화면에 개발 용어가 남아 있지 않은가 (사장님·코치가 읽는 글이다)
    // 사용자에게 실제로 출력되는 문구만 본다: alert(…) · textContent = '…' · '…' 안의 한글 문장
    const jargon = ['undefined','null','NaN','[object Object]','TODO','FIXME','Error:','500 Internal'];
    const found = [];
    for (const f of all) {
      const src = ctx.readAbs(f);
      const shown = [
        ...[...src.matchAll(/alert\(\s*[`'"]([^`'"]{2,200})[`'"]/g)].map(m => m[1]),
        ...[...src.matchAll(/textContent\s*=\s*[`'"]([^`'"]{2,200})[`'"]/g)].map(m => m[1]),
        ...[...src.matchAll(/error:\s*[`'"]([^`'"]{2,200})[`'"]/g)].map(m => m[1]),
      ];
      for (const line of shown) {
        if (!/[가-힣]/.test(line)) continue;
        for (const w of jargon) if (line.includes(w)) found.push(`${ctx.rel(f)}: "${line.slice(0, 70)}"`);
      }
    }
    checks.push(check('사용자 문구에 개발 용어가 없다', {
      universe: all.length, scanned: all.length, passed: all.length - new Set(found.map(f => f.split(':')[0])).size,
      notes: found.slice(0, 15),
    }));

    // ── 3. 되돌릴 수 없는 버튼이 확인을 받는가
    const destructive = [];
    let deleteFns = 0;
    for (const f of scripts) {
      const src = ctx.readAbs(f);
      for (const m of src.matchAll(/async function (\w*(?:delete|remove|purge|reset)\w*)\s*\([^)]*\)\s*\{([\s\S]{0,400}?)\n\}/gi)) {
        deleteFns++;
        if (!/confirm\(/.test(m[2])) destructive.push(`${m[1]}() 가 확인 없이 지운다 (${ctx.rel(f)})`);
      }
    }
    checks.push(check('지우는 버튼이 확인을 받는다', {
      universe: deleteFns, scanned: deleteFns, passed: deleteFns - destructive.length, notes: destructive,
    }));

    // ── 4. 서버 오류 메시지가 한국어인가
    const serverMsgs = [];
    let msgCount = 0;
    for (const f of ctx.files(['backend'], ['.js'])) {
      const src = ctx.readAbs(f);
      for (const m of src.matchAll(/error:\s*[`'"]([^`'"]{2,80})[`'"]/g)) {
        msgCount++;
        if (!/[가-힣]/.test(m[1])) serverMsgs.push(`${ctx.rel(f)}: "${m[1]}"`);
      }
    }
    checks.push(check('서버 오류 메시지가 한국어다', {
      universe: msgCount, scanned: msgCount, passed: msgCount - serverMsgs.length, notes: serverMsgs.slice(0, 15),
    }));

    // ── 5. 빈 상태에 안내 문구가 있는가
    // 문구가 그 자리에 바로 적혀 있을 수도 있고, 부르는 쪽에서 넘겨줄 수도 있다.
    // 변수로 들어오는 경우는 여기서 내용을 알 수 없으므로 결함으로 세지 않는다.
    const emptyAll = [...ctx.clientSrc.matchAll(/empty-state[^>]*>([^<]*)</g)].map(m => m[1]);
    const withText = emptyAll.filter(t => /[가-힣]/.test(t));
    const viaVar = emptyAll.filter(t => !/[가-힣]/.test(t) && /\$\{/.test(t));
    const blank = emptyAll.filter(t => !/[가-힣]/.test(t) && !/\$\{/.test(t));
    checks.push(check('빈 목록에 안내 문구가 있다', {
      universe: emptyAll.length, scanned: emptyAll.length,
      passed: withText.length, warned: viaVar.length,
      warnNotes: viaVar.map(() => '문구를 부르는 쪽에서 넘긴다 — 내용은 그쪽을 봐야 안다'),
      notes: blank.map(() => '빈 목록인데 아무 설명이 없다'),
    }));

    return { checks };
  },
};
