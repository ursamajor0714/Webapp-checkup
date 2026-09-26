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

    // ── 6. 접근성 기본 — 화면을 못 보는 사람(스크린리더), 폰으로 보는 사람도 읽을 수 있는가
    // 대기업 기준(100)에는 접근성 점검이 들어 있다. 여기서는 소스만으로 확실히 가려지는 것만 본다.
    const src = all.map(f => ctx.readAbs(f)).join('\n');
    // 페이지마다 언어·폰 화면 설정 (partials 는 조각이라 뺀다)
    const pages = views.filter(f => !/partials/.test(f));
    const pageBad = [];
    for (const f of pages) {
      const s = ctx.readAbs(f);
      if (!/<html[^>]*\slang=/.test(s)) pageBad.push(`${ctx.rel(f)}: <html lang> 이 없다 — 스크린리더가 한국어로 안 읽는다`);
      if (!/name="viewport"/.test(s)) pageBad.push(`${ctx.rel(f)}: viewport 가 없다 — 폰에서 글씨가 깨알만 해진다`);
    }
    checks.push(check('페이지마다 언어와 폰 화면 설정이 있다', {
      universe: pages.length * 2, scanned: pages.length * 2, passed: pages.length * 2 - pageBad.length, notes: pageBad,
    }));
    // 그림에 대체 글
    const imgs = [...src.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
    const noAlt = imgs.filter(t => !/\salt=/.test(t));
    checks.push(check('그림에 대체 글(alt)이 있다', {
      universe: imgs.length, scanned: imgs.length, passed: imgs.length - noAlt.length,
      notes: noAlt.map(t => t.slice(0, 70)),
    }));
    // 글자 없는 버튼 (아이콘만 있는 버튼은 스크린리더가 '버튼' 이라고만 읽는다)
    const buttons = [...src.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    const mute = buttons.filter(([, attrs, inner]) =>
      !/aria-label=|title=/.test(attrs) && !/[가-힣A-Za-z0-9]|\$\{|<%/.test(inner.replace(/<[^>]+>/g, '')));
    checks.push(check('버튼에 읽을 수 있는 이름이 있다', {
      universe: buttons.length, scanned: buttons.length, passed: buttons.length - mute.length,
      notes: mute.map(m => m[0].replace(/\s+/g, ' ').slice(0, 70)),
    }));
    // 입력칸 이름표 — <label for>·aria-label·<label> 로 감싼 것만 확실하다.
    // 확인 필요로 두는 것:
    //  · placeholder 만 있다 — 글을 치면 사라진다
    //  · 바로 앞에 <label>글</label> 이 있지만 for 로 연결 안 됐다 — 눈으로는 보이지만 스크린리더는 모른다
    //    (for="id" 한 줄이면 고쳐진다)
    const labelFor = new Set([...src.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map(m => m[1]));
    const inputs = [...src.matchAll(/<(input|select|textarea)\b([^>]*)>/g)]
      .filter(([, , a]) => !/type="(hidden|submit|button|checkbox|radio)"/.test(a));
    let labeled = 0; const phOnly = []; const bare = [];
    for (const m of inputs) {
      const [tag, , a] = m;
      const id = (a.match(/\sid="([^"]+)"/) || [])[1];
      // <label>이름 <input></label> 처럼 감싸는 것도 이름표다
      const before = src.slice(0, m.index);
      const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
      if (wrapped || /aria-label=|aria-labelledby=/.test(a) || (id && labelFor.has(id))) labeled++;
      else if (/placeholder=/.test(a)) phOnly.push('placeholder 만 있다 — ' + tag.slice(0, 70));
      else if (/<\/label>\s*(<br\s*\/?>\s*)?$/.test(before)) phOnly.push('앞 <label> 이 for 로 연결 안 됐다 — ' + tag.slice(0, 70));
      else bare.push(tag.replace(/\s+/g, ' ').slice(0, 70));
    }
    checks.push(check('입력칸에 이름표가 있다', {
      universe: inputs.length, scanned: inputs.length, passed: labeled,
      warned: phOnly.length, warnNotes: phOnly,
      notes: bare.map(t => '이름표가 없다 — ' + t),
    }));

    return { checks };
  },
};
