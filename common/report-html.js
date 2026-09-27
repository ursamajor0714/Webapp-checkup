// 리포트를 HTML 파일 하나로 — 인터넷 없이 열리고, 팀에 그대로 보낼 수 있다 (CSS 까지 안에 들어 있다)
//   요약 점수 · 지난 검사와 비교 · 먼저 고칠 것 Top 10 · OWASP Top 10 · 영역별 문제(X)·확인 필요(△) 목록 · 잴 수 없었던 영역
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function rowsOf(c) {
  if (c.items) return c.items.map(i => ({ name: i.name, detail: i.detail || '', mark: i.ok === true ? 'ok' : i.ok === null ? 'warn' : 'bad' }));
  const rows = [];
  if (c.failed > 0) (c.notes && c.notes.length ? c.notes : [`${c.failed}건 문제`]).forEach(n => rows.push({ name: c.name, detail: n, mark: 'bad' }));
  (c.warnNotes || []).forEach(n => rows.push({ name: c.name, detail: n, mark: 'warn' }));
  if (c.passed > 0 || !rows.length) rows.push({ name: c.name, detail: `${c.passed}건 통과`, mark: 'ok' });
  return rows;
}

function renderHtml(report) {
  const s = report.summary;
  const mark = m => (m === 'ok' ? 'O' : m === 'bad' ? 'X' : '△');
  const d = s.diff;
  const delta = d ? Math.round((d.score - d.prevScore) * 10) / 10 : null;
  const areas = report.results.map(r => {
    if (r.skip) return `<details class="area skip"><summary><b>${esc(r.id)}</b> ${esc(r.name)} <span class="chip">잴 수 없음</span></summary><p class="muted">${esc(r.skip)}</p></details>`;
    const rows = (r.checks || []).flatMap(c => rowsOf(c).map(x => ({ ...x, check: c.name })));
    const bad = rows.filter(x => x.mark === 'bad'), warn = rows.filter(x => x.mark === 'warn'), ok = rows.filter(x => x.mark === 'ok');
    const list = [...bad, ...warn].slice(0, 400);
    return `<details class="area" ${bad.length ? 'open' : ''}><summary><b>${esc(r.id)}</b> ${esc(r.name)}
      ${bad.length ? `<span class="chip bad">X ${bad.length}</span>` : ''}${warn.length ? `<span class="chip warn">△ ${warn.length}</span>` : ''}<span class="chip ok">O ${ok.length}</span></summary>
      ${list.length ? `<table>${list.map(x => `<tr class="${x.mark}"><td class="m ${x.mark}">${mark(x.mark)}</td><td class="c">${esc(x.check)}</td><td>${esc(x.name)}</td><td class="muted">${esc(x.detail)}</td></tr>`).join('')}</table>` : '<p class="muted">문제·확인 필요 없음</p>'}
      ${(r.skipped || []).length ? `<p class="muted">건너뛴 것: ${r.skipped.map(esc).join(' · ')}</p>` : ''}</details>`;
  }).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA 리포트 — ${esc(s.target)}</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--line:#e3e6eb;--text:#1b1f24;--muted:#667080;--ok:#1a7f45;--okbg:#e5f5ec;--bad:#c62828;--badbg:#fdecea;--warn:#a15c00;--warnbg:#fff3dc}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--panel:#171b21;--line:#2a3038;--text:#e7eaee;--muted:#9aa4b1;--ok:#4cc38a;--okbg:#12301f;--bad:#ff6b6b;--badbg:#3a1716;--warn:#f0b24a;--warnbg:#3a2a10}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 "Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 60px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px}
.muted{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:16px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}.card .v{font-size:24px;font-weight:700}.card .k{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--panel)}td{border-top:1px solid var(--line);padding:6px 10px;vertical-align:top;word-break:break-word}
td.m{width:34px;text-align:center;font-weight:800}.m.ok{color:var(--ok)}.m.bad{color:var(--bad)}.m.warn{color:var(--warn)}td.c{width:26%;color:var(--muted);font-size:13px}
tr.bad td{background:color-mix(in srgb,var(--badbg) 60%,transparent)}
.chip{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;margin-left:6px;background:var(--line)}.chip.ok{background:var(--okbg);color:var(--ok)}.chip.bad{background:var(--badbg);color:var(--bad)}.chip.warn{background:var(--warnbg);color:var(--warn)}
details.area{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin:8px 0;overflow:hidden}details.area>summary{padding:10px 14px;cursor:pointer}details.area p{padding:0 14px}
.box{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
</style></head><body><main>
<h1>QA 리포트 — ${esc(s.target)}</h1>
<div class="muted">${esc(String(s.at).slice(0, 16).replace('T', ' '))} (UTC) · ${esc(s.root)} · ${(s.parts || []).map(p => esc(`${p.stack}@${p.dir}`)).join(' · ')}</div>
<div class="cards">
  <div class="card"><div class="k">제품 점수${s.level ? ` · ${esc(s.level.label)} 검사` : ''}</div><div class="v">${esc(s.score)}</div><div class="k">등급 ${esc(s.grade)}${s.level && s.level.strict ? ' · 확인 필요도 감점' : ''}</div></div>
  <div class="card"><div class="k">운영 성숙도 (따로 본다)</div><div class="v">${esc(s.maturity.got)}/${esc(s.maturity.total)}</div><div class="k">${esc(s.maturity.label || '')}</div></div>
  ${s.actionable ? `<div class="card"><div class="k">손댈 곳</div><div class="v">${esc(s.actionable.fix)}곳</div><div class="k">문제 ${esc(s.actionable.failed)}건을 원인별로 묶음 · 사람이 볼 곳 ${esc(s.actionable.look)}곳</div></div>` : ''}
  <div class="card"><div class="k">검사 / 통과 / 문제 / 확인 필요</div><div class="v">${esc(s.scanned)}</div><div class="k">통과 ${esc(s.passed)} · 문제 ${esc(s.failed)} · 확인 ${esc(s.warned)} · 자동 생성 ${esc(s.generated ?? '-')}</div></div>
  ${(s.sections || []).map(x => `<div class="card"><div class="k">${esc(x.label)}</div><div class="v">${x.score === null ? '-' : esc(x.score)}</div></div>`).join('')}
</div>
${d ? `<h2>▲ 지난 검사와 비교 <span class="chip">${esc(String(d.prevAt || '').slice(0, 16).replace('T', ' '))}</span></h2>
<p>점수 ${esc(d.prevScore)} → <b>${esc(d.score)}</b> (${delta >= 0 ? '+' : ''}${esc(delta)}) · <span class="chip bad">새 문제 ${esc(d.addedCount)}</span><span class="chip ok">고친 것 ${esc(d.fixedCount)}</span>${d.same ? `<span class="chip">같은 영역 ${esc(d.same.areas)}개끼리 ${esc(d.same.prev)} → ${esc(d.same.now)}</span>` : ''}</p>
${(d.areaChanges || []).length && Math.abs(delta) >= 0.5 ? `<div class="box" style="margin-bottom:10px"><table>${d.areaChanges.map(c => `<tr><td class="m warn">Δ</td><td class="c">[${esc(c.id)}] ${esc(c.name)}</td><td>${esc(c.before ?? '못 잼')} → ${esc(c.after ?? '못 잼')}</td><td class="muted">${esc(c.why.join(' · '))}</td></tr>`).join('')}</table></div>` : ''}
<div class="box"><table>${d.added.map(x => `<tr class="bad"><td class="m bad">+</td><td class="c">[${esc(x.area)}] ${esc(x.check)}</td><td>${esc(x.item)}</td><td class="muted">${esc(x.detail)}</td></tr>`).join('')}${d.fixed.map(x => `<tr><td class="m ok">✓</td><td class="c">[${esc(x.area)}] ${esc(x.check)}</td><td>${esc(x.item)}</td><td class="muted">고쳐졌다</td></tr>`).join('')}</table></div>` : ''}
${(s.setupErrors || []).length ? `<h2>⚠ 설정 오류 <span class="chip warn">제품 결함 아님 — 점수에 넣지 않았다</span></h2><div class="box"><table>${s.setupErrors.map(e => `<tr><td class="m warn">⚙</td><td>${esc(e)}</td></tr>`).join('')}</table></div>` : ''}
${(s.saas || []).length ? `<h2>☁ 기대는 외부 서비스 <span class="chip">참고 — 점수에 넣지 않는다</span></h2><div class="box"><table>${s.saas.map(x => `<tr><td class="m">·</td><td class="c"><b>${esc(x.name)}</b> · ${esc(x.kind)}</td><td>${esc(x.watch)}</td><td class="muted">${esc(x.why.join(' · '))}</td></tr>`).join('')}</table></div>` : ''}
${(s.top || []).length ? `<h2>★ 먼저 고칠 것</h2><div class="box"><table>${s.top.map((t, i) => `<tr class="bad"><td class="m bad">${i + 1}</td><td class="c">[${esc(t.area)}] ${esc(t.areaName)}</td><td><b>${esc(t.check)}</b> <span class="chip bad">${esc(t.failed)}건</span>${t.owasp ? `<span class="chip">${esc([].concat(t.owasp).join(','))}</span>` : ''}</td><td class="muted">${t.examples.map(esc).join('<br>')}</td></tr>`).join('')}</table></div>` : ''}
${report.maturity ? (() => { const m = report.maturity; const items = [...m.items].sort((a, b) => (a.ok - b.ok) || ((b.plus || 0) - (a.plus || 0))); const all = Math.round(items.filter(i => !i.ok).reduce((a, i) => a + (i.plus || 0), 0) * 10) / 10;
  return `<h2>◆ 운영 성숙도 ${esc(m.got)}/${esc(m.total)} <span class="chip">제품 점수와 따로 본다</span>${all ? `<span class="chip bad">빠진 것 ${esc(all)}점</span>` : ''}</h2>
<div class="box"><table>${items.map(i => `<tr class="${i.ok ? 'ok' : 'bad'}"><td class="m ${i.ok ? 'ok' : 'bad'}">${i.ok ? 'O' : 'X'}</td><td class="c">${esc(i.label)}<br>${esc(i.weight)}점${!i.ok && i.plus ? ` · 갖추면 +${esc(i.plus)}` : ''}</td><td>${i.why ? esc(i.why) : ''}<br><span class="muted">${i.ok ? '찾은 것: ' + esc(i.found || '') : '찾아본 곳: ' + esc(i.look || '')}</span></td><td class="muted">${!i.ok && i.how ? i.how.map(h => '· ' + esc(h)).join('<br>') : ''}</td></tr>`).join('')}</table></div>`; })() : ''}
<h2>OWASP Top 10 (2021)</h2>
<div class="box"><table>${(s.owasp || []).map(o => { const m = o.status === '통과' ? 'ok' : o.status === '문제' ? 'bad' : o.status === '확인 필요' ? 'warn' : ''; return `<tr class="${m}"><td class="m ${m}">${m ? mark(m) : '-'}</td><td class="c">${esc(o.id)}</td><td>${esc(o.name)}</td><td class="muted">${esc(o.status)} · 검사 ${esc(o.scanned)} · 문제 ${esc(o.failed)} · 확인 ${esc(o.warned)}</td></tr>`; }).join('')}</table></div>
<h2>영역별 결과 <span class="muted" style="font-size:13px;font-weight:400">문제(X)·확인 필요(△)만 펼쳐 보인다</span></h2>
${areas}
<p class="muted" style="margin-top:28px">범용 QA — 서버가 필요한 영역을 잴 수 없었으면 점수에서 뺐다. △ 확인 필요는 사람이 볼 목록이며 점수에 넣지 않았다.</p>
</main></body></html>`;
}

module.exports = { renderHtml };
