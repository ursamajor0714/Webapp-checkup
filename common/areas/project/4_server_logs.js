// 4. 서버 로그 오류 — 검사가 서버를 두드리는 동안 서버가 로그에 찍은 예외·스택·크래시
//   응답은 멀쩡해 보여도 뒤에서 터지는 것(처리 안 된 Promise, 로그만 찍고 삼킨 예외)을 잡는다.
//   QA(명령줄·화면)가 켠 서버만 로그를 볼 수 있다. 맨 마지막에 돈다 (모든 검사가 남긴 로그를 본다).
const { checkItems } = require('../_util');

// 확실한 결함 — 코드가 예상하지 못한 예외
const BUG = /Unhandled(?:PromiseRejection| Rejection| error)|uncaughtException|TypeError|ReferenceError|RangeError|SyntaxError(?!.*JSON)|Cannot read propert|is not a function|is not defined|Traceback \(most recent call last\)|NullPointerException|IndexError|KeyError|AttributeError|ZeroDivisionError|IntegrityError|SqliteError|constraint failed|violates [\w -]*constraint|duplicate key value|Deadlock|Internal Server Error|\bFATAL\b|segmentation fault|heap out of memory/i;
// 오류를 뜻하지만 일부러 찍었을 수도 있는 것 (처리하고 남긴 기록)
const WARN = /\b(?:error|exception|failed|ECONNREFUSED|ETIMEDOUT|EADDRINUSE|deprecat\w*|warn(?:ing)?)\b/i;
// 요청 기록(access log) 한 줄 — 4xx 는 검사가 일부러 만든 것
const ACCESS = /^\s*(?:\[[^\]]*\]\s*)?"?(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\S+.*\b[1-4]\d\d\b|^\S+ - - \[.*\] ".*" [1-4]\d\d /;

// 같은 오류를 하나로 — 숫자·id·주소·따옴표 안 값을 지운다
const signature = l => l.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?|\b\d+(\.\d+)?\b|0x[0-9a-f]+|[0-9a-f]{8,}|'[^']*'|"[^"]*"|\/[\w./-]+:\d+/gi, '…').replace(/\s+/g, ' ').trim().slice(0, 160);

module.exports = {
  id: '4', name: '서버 로그 오류', weight: 5, last: 2,
  async run(ctx) {
    const states = Object.entries(ctx.serverStates || {});
    if (!states.length) return { skip: '서버 로그를 볼 수 없다 — QA 가 켠 서버만 본다. 서버를 끈 채로 검사를 돌리면(명령줄·화면 모두) QA 가 켜고 로그까지 본다' };
    const checks = [];
    const crash = [];
    for (const [dir, st] of states) {
      const lines = st.log.slice(st.readyAt || 0);
      const bugs = new Map(), warns = new Map();
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (ACCESS.test(l) || /^\$ /.test(l) || /켜졌습니다/.test(l)) continue;
        const bucket = BUG.test(l) ? bugs : WARN.test(l) && !/\[audit\]/.test(l) ? warns : null;
        if (!bucket) continue;
        const sig = signature(l);
        const e = bucket.get(sig) || { n: 0, first: l.trim(), next: (lines[i + 1] || '').trim() };
        e.n++; bucket.set(sig, e);
      }
      const label = `${dir === '.' ? '서버' : dir}`;
      const items = [
        ...[...bugs.values()].sort((a, b) => b.n - a.n).map(e => ({ name: `${label} · ${e.n}번`, ok: false, detail: `${e.first.slice(0, 220)}${/^\s*at\s/.test(e.next) ? ' ← ' + e.next.slice(0, 120) : ''}` })),
        ...[...warns.values()].sort((a, b) => b.n - a.n).slice(0, 20).map(e => ({ name: `${label} · ${e.n}번`, ok: null, detail: `${e.first.slice(0, 220)} — 일부러 남긴 기록인지 확인` })),
      ];
      checks.push(checkItems(`검사하는 동안 ${label} 로그에 예외가 없다 (로그 ${lines.length}줄)`, items.length ? items : [{ name: label, ok: true, detail: `로그 ${lines.length}줄에 예외·오류 없음` }]));
      if (st.phase === 'error' || (st.startedByQa && !st.child)) crash.push({ name: label, ok: false, detail: `검사 도중 서버가 꺼졌다 — ${st.error || ''} · 마지막 로그: ${st.log.slice(-3).join(' / ').slice(0, 200)}` });
      else crash.push({ name: label, ok: true, detail: '검사 내내 살아 있었다' });
    }
    checks.push(checkItems('검사 도중 서버가 죽지 않는다', crash));
    return { checks };
  },
};
