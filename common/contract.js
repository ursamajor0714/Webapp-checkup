// ============================================================
// 계약(contract) 기반 자동 생성 검사
//
// "이 API 는 이런 모양의 데이터를 받는다" 를 적어 두면 검사 케이스를 기계가 만든다.
// 사람이 케이스를 하나씩 쓰면 15개에서 멈추지만, 규칙에서 만들면 필드 × 값 유형 × 조합으로 수백 개가 된다.
//
// 판정(오라클)은 셋뿐이다 — 이게 케이스가 늘어도 판정이 흔들리지 않는 이유다.
//   valid   : 2xx 로 받고, 다시 읽으면 보낸 값 그대로여야 한다 (왕복)
//   invalid : 4xx 로 거절하고, 아무것도 바뀌지 않아야 한다
//   any     : 받든 거절하든 괜찮다. 단 5xx 는 안 되고, 받았다면 보낸 그대로여야 한다
// 어떤 경우든 5xx 는 불합격이다.
//
// 필드 규칙 (entity.fields)
//   { type: 'string',  required, min, max, pattern }
//   { type: 'number',  required, min, max, integer }
//   { type: 'enum',    required, values | valuesFrom: async ctx => [...] }
//   { type: 'object',  required, fields: { … } }
//
// 필드 간 규칙 (entity.rules) — 필드 하나만 봐선 알 수 없는 규칙
//   { name, broken: body => true 면 이 본문은 규칙 위반 → 거절돼야 한다, example: base => 위반 본문 }
//   조합 검사에서 규칙을 어기는 줄은 자동으로 '거절 기대' 가 된다.
// ============================================================
const INJECTIONS = ["<script>alert(1)</script>", "' OR 1=1 --", '{{7*7}}', '../../etc/passwd'];

const isEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok2xx = s => s >= 200 && s < 300;
const ok4xx = s => s >= 400 && s < 500;

// ── 필드 하나의 값 유형들 { label, value, expect, omit? }
function valueCases(spec, sampleOf) {
  const out = [];
  const add = (label, value, expect, omit) => out.push({ label, value, expect, omit });
  const nullExpect = spec.required ? 'invalid' : 'any';
  add('빠짐', undefined, spec.required ? 'invalid' : 'valid', true);
  add('null', null, nullExpect);

  if (spec.type === 'boolean') {
    add('true', true, 'valid'); add('false', false, 'valid');
    add('문자열 "true"', 'true', 'invalid'); add('숫자 1', 1, 'invalid'); add('배열 타입', [true], 'invalid');
  } else if (spec.type === 'any' || spec.type === 'array') {
    // 모양을 모르는 칸 — 서버가 죽지 않는지만 본다
    for (const [label, v] of [['문자열', 'qa'], ['빈 문자열', ''], ['숫자', 123], ['음수', -1], ['아주 큰 수', 1e308], ['불리언', true], ['배열', ['a']], ['객체', { a: 1 }], ['아주 긴 문자열(10000자)', 'a'.repeat(10000)], ['주입 문자열 <script>', '<script>alert(1)</script>'], ["주입 문자열 ' OR 1=1", "' OR 1=1 --"], ['NoSQL 연산자', { $gt: '' }]]) add(label, v, 'any');
  } else if (spec.type === 'string') {
    const max = spec.max ?? 100;
    const min = spec.min ?? (spec.required ? 1 : 0);
    add('정상 값', sampleOf(spec), 'valid');
    const fill = n => spec.format === 'email' ? 'q'.repeat(Math.max(1, n - 12)) + '@example.com' : 'a'.repeat(n);
    if (spec.max !== undefined && !spec.pattern) add(`최대 길이(${max}자)`, fill(max), 'valid');
    add(`최대 길이 초과(${max + 1}자)`, fill(max + 1), spec.max !== undefined ? 'invalid' : 'any');
    if (spec.min > 1) add(`최소 길이 미만(${spec.min - 1}자)`, 'a'.repeat(spec.min - 1), 'invalid');
    add('빈 문자열', '', min > 0 ? 'invalid' : (spec.pattern ? 'invalid' : 'valid'));
    add('공백만', '   ', spec.pattern ? 'invalid' : 'any');
    add('숫자 타입', 12345, 'invalid');
    add('불리언 타입', true, 'invalid');
    add('배열 타입', ['a'], 'invalid');
    // 최소 길이는 채운다. 8자 이상 규칙(비밀번호 꼴)은 서버의 강도 규칙이 따로 있을 수 있어 '서버 오류 없음' 만 본다
    const ko = '가나다🔥' + '가'.repeat(Math.max(0, min - 4));
    add('한글·이모지', ko, (spec.pattern && !spec.pattern.test(ko)) || spec.format ? 'invalid' : min >= 8 ? 'any' : 'valid');
    if (spec.format === 'email') { add('이메일 아님', 'not-an-email', 'invalid'); add('@ 만', '@', 'invalid'); add('도메인 없음', 'qa@', 'invalid'); }
    if (spec.format === 'url') { add('URL 아님', 'not a url', 'invalid'); add('javascript: URL', 'javascript:alert(1)', 'invalid'); }
    if (spec.format === 'uuid') add('UUID 아님', '1234', 'invalid');
    add('NoSQL 연산자 객체', { $gt: '' }, 'invalid');
    for (const inj of INJECTIONS) {
      const fits = inj.length <= max && (!spec.pattern || spec.pattern.test(inj));
      add(`주입 문자열 ${inj.slice(0, 14)}`, inj, spec.pattern ? (fits ? 'valid' : 'invalid') : 'any');
    }
  } else if (spec.type === 'number') {
    const { min = 0, max = 100 } = spec;
    add(`최솟값(${min})`, min, 'valid');
    add(`최댓값(${max})`, max, 'valid');
    add('중간값', spec.integer ? Math.round((min + max) / 2) : (min + max) / 2, 'valid');
    add(`최솟값 미만(${min - 1})`, min - 1, 'invalid');
    add(`최댓값 초과(${max + 1})`, max + 1, 'invalid');
    add('아주 큰 수(1e308)', 1e308, 'invalid');
    add('숫자 모양 문자열("5")', '5', 'invalid');
    add('문자열', 'abc', 'invalid');
    add('불리언 타입', true, 'invalid');
    add('배열 타입', [1], 'invalid');
    if (spec.integer) add('소수(1.5)', min + 1.5, 'invalid');
  } else if (spec.type === 'enum') {
    for (const v of spec.values) add(`목록 값 ${v}`, v, 'valid');
    add('목록 밖 값', 'QA_BOGUS', 'invalid');
    add('소문자로 바꾼 값', String(spec.values[0]).toLowerCase(), String(spec.values[0]).toLowerCase() === spec.values[0] ? 'valid' : 'invalid');
    add('빈 문자열', '', 'invalid');
    add('숫자 타입', 0, 'invalid');
  } else if (spec.type === 'object') {
    add('정상 값', sampleOf(spec), 'valid');
    add('빈 객체 {}', {}, 'invalid');
    add('배열 타입', [], 'invalid');
    add('문자열', 'x', 'invalid');
    for (const [k, sub] of Object.entries(spec.fields)) {
      for (const c of valueCases({ ...sub, required: true }, sampleOf)) {
        if (c.omit || c.label === 'null' || c.label === '정상 값') continue;
        const v = { ...sampleOf(spec) };
        v[k] = c.value;
        out.push({ label: `${k} ${c.label}`, value: v, expect: c.expect });
      }
    }
  }
  return out;
}

// 규칙에서 정상 표본 하나
function sampleOf(spec) {
  if (spec.sample !== undefined) return spec.sample;
  switch (spec.type) {
    case 'string':
      if (spec.format === 'email') return 'qa@example.com';
      if (spec.format === 'url') return 'https://example.com/qa';
      if (spec.format === 'uuid') return '123e4567-e89b-42d3-a456-426614174000';
      if (spec.format === 'datetime') return new Date().toISOString();
      return 'qa' + 'x'.repeat(Math.max(0, (spec.min ?? 1) - 2));
    case 'boolean': return true;
    case 'any': case 'array': return spec.type === 'array' ? [] : 'qa';
    case 'number': return spec.integer ? Math.ceil(((spec.min ?? 0) + (spec.max ?? 100)) / 2) : ((spec.min ?? 0) + (spec.max ?? 100)) / 2;
    case 'enum': return spec.values[0];
    case 'object': return Object.fromEntries(Object.entries(spec.fields).map(([k, s]) => [k, sampleOf(s)]));
    default: return null;
  }
}

// 목록 값 필드를 실제 값으로 채운다 (valuesFrom — 예: 서버에서 층 목록 받아 오기)
async function resolveFields(ctx, fields) {
  const out = {};
  for (const [k, spec] of Object.entries(fields)) {
    out[k] = { ...spec };
    if (spec.valuesFrom) out[k].values = await spec.valuesFrom(ctx);
    if (spec.fields) out[k].fields = await resolveFields(ctx, spec.fields);
  }
  return out;
}

// ── 페어와이즈: 목록 필드들의 '두 개씩 모든 짝' 을 덮는 최소에 가까운 조합 (탐욕법)
function pairwise(factors) {
  const names = Object.keys(factors);
  const uncovered = new Set();
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++)
    for (const a of factors[names[i]]) for (const b of factors[names[j]]) uncovered.add(`${i}=${a}|${j}=${b}`);
  const rows = [];
  let guard = 0;
  while (uncovered.size && guard++ < 5000) {
    // 아직 안 덮인 짝 하나에서 출발해, 나머지 칸은 새 짝을 가장 많이 덮는 값으로 채운다
    const [first] = uncovered;
    const [[i, a], [j, b]] = first.split('|').map(p => p.split('=')).map(([k, v]) => [Number(k), v]);
    const row = {}; row[i] = a; row[j] = b;
    for (let k = 0; k < names.length; k++) {
      if (k in row) continue;
      let best = factors[names[k]][0], bestGain = -1;
      for (const v of factors[names[k]]) {
        let gain = 0;
        for (const [m, mv] of Object.entries(row)) {
          const [x, y] = Number(m) < k ? [`${m}=${mv}`, `${k}=${v}`] : [`${k}=${v}`, `${m}=${mv}`];
          if (uncovered.has(`${x}|${y}`)) gain++;
        }
        if (gain > bestGain) { best = v; bestGain = gain; }
      }
      row[k] = best;
    }
    for (let x = 0; x < names.length; x++) for (let y = x + 1; y < names.length; y++) uncovered.delete(`${x}=${row[x]}|${y}=${row[y]}`);
    rows.push(Object.fromEntries(names.map((n, k) => [n, row[k]])));
  }
  return rows;
}

const fmt = v => v === undefined ? '(빠짐)' : typeof v === 'string' ? (v.length > 24 ? JSON.stringify(v.slice(0, 20) + '…') : JSON.stringify(v)) : JSON.stringify(v).slice(0, 40);

// 요청 하나의 판정
function judge(expect, status, storedOk, unchanged) {
  if (status >= 500) return { ok: false, why: `서버 오류 ${status}` };
  if (expect === 'valid') {
    if (!ok2xx(status)) return { ok: false, why: `올바른 값인데 ${status} 로 거절` };
    if (storedOk === false) return { ok: false, why: '받았다면서 다른 값으로 저장' };
    return { ok: true, why: `${status} 저장 · 왕복 일치` };
  }
  if (expect === 'invalid') {
    if (!ok4xx(status)) return { ok: false, why: `틀린 값인데 ${status} 로 받아들임` };
    if (unchanged === false) return { ok: false, why: `${status} 인데 데이터가 바뀜` };
    return { ok: true, why: `${status} 거절 · 변화 없음` };
  }
  if (ok2xx(status) && storedOk === false) return { ok: false, why: '받았다면서 다른 값으로 저장' };
  return { ok: true, why: `${status}${ok2xx(status) ? ' 저장 · 왕복 일치' : ' 거절'}` };
}

/**
 * 엔티티 하나의 CRUD 를 계약대로 두드린다.
 * entity = { name, idField, idPrefix, fields, updatable, base(i) → 정상 본문, list(ctx), create(ctx, body), update(ctx, id, patch), remove(ctx, id) }
 * 돌려주는 것: { create: items, update: items, combos: items, shapes: items }
 */
async function runEntity(ctx, entity) {
  const fields = await resolveFields(ctx, entity.fields);
  const idField = entity.idField || 'id';
  let seq = 0;
  const newId = () => `${entity.idPrefix || 'qa-gen-'}${Date.now().toString(36)}${(seq++).toString(36)}`;
  const find = async id => (await entity.list(ctx)).find(x => x[idField] === id);
  const created = new Set();
  const cleanup = async () => { for (const id of created) await entity.remove(ctx, id); created.clear(); };
  const res = { create: [], update: [], combos: [], shapes: [] };

  try {
    // ── 1. 등록: 정상 본문에서 필드 하나씩 바꿔 본다 (한 번에 한 요인)
    for (const [field, spec] of Object.entries(fields)) {
      if (field === idField) continue;
      for (const c of valueCases(spec, sampleOf)) {
        const id = newId();
        const body = { ...entity.base(fields), [idField]: id };
        if (c.omit) delete body[field]; else body[field] = c.value;
        const r = await entity.create(ctx, body);
        const saved = await find(id);
        if (saved) created.add(id);
        const storedOk = saved ? (c.omit ? true : isEq(saved[field], c.value)) : (ok2xx(r.status) ? false : undefined);
        const v = judge(c.expect, r.status, storedOk, !saved);
        res.create.push({ name: `등록 · ${field} ${c.label}`, ok: v.ok, detail: `보냄 ${fmt(c.omit ? undefined : c.value)} · 기대 ${c.expect === 'valid' ? '저장' : c.expect === 'invalid' ? '거절' : '5xx 아님'} · ${v.why}` });
        if (created.size > 20) await cleanup();
      }
    }
    // id 자체의 값 유형
    if (fields[idField]) {
      for (const c of valueCases(fields[idField], sampleOf)) {
        if (c.omit || c.label === '정상 값') continue;
        const body = { ...entity.base(fields), [idField]: c.value };
        const before = (await entity.list(ctx)).length;
        const r = await entity.create(ctx, body);
        const after = await entity.list(ctx);
        const saved = after.find(x => isEq(x[idField], c.value));
        if (saved && typeof c.value === 'string') created.add(c.value);
        const v = judge(c.expect, r.status, saved ? true : (ok2xx(r.status) ? false : undefined), after.length === before);
        // 받아 놓고 지울 수도 없는 id 면 따로 적는다 (숫자 id 처럼)
        let why = v.why;
        if (saved && typeof c.value !== 'string') {
          await entity.remove(ctx, String(c.value));
          if ((await entity.list(ctx)).some(x => isEq(x[idField], c.value))) { v.ok = false; why += ' · 지울 수도 없음'; }
        }
        res.create.push({ name: `등록 · ${idField} ${c.label}`, ok: v.ok, detail: `보냄 ${fmt(c.value)} · 기대 ${c.expect === 'valid' ? '저장' : '거절'} · ${why}` });
      }
    }
    // 필드 간 규칙 — 규칙마다 위반 본문을 하나씩 만들어 등록·수정 둘 다 거절되는지 본다
    for (const rule of entity.rules || []) {
      const id = newId();
      const body = { ...rule.example(entity.base(fields)), [idField]: id };
      const r = await entity.create(ctx, body);
      const saved = await find(id);
      if (saved) created.add(id);
      const v = judge('invalid', r.status, undefined, !saved);
      res.create.push({ name: `등록 · 규칙 위반: ${rule.name}`, ok: v.ok, detail: `보냄 ${fmt(body)} · 기대 거절 · ${v.why}` });
    }
    await cleanup();

    // ── 2. 수정: 검사용 센서 하나를 만들어 필드 하나씩 바꿔 본다 (실제 데이터는 건드리지 않는다)
    const targetId = newId();
    await entity.create(ctx, { ...entity.base(fields), [idField]: targetId });
    created.add(targetId);
    for (const field of entity.updatable || Object.keys(fields)) {
      const spec = fields[field];
      for (const c of valueCases({ ...spec, required: true }, sampleOf)) {
        if (c.omit) continue;
        const before = await find(targetId);
        const r = await entity.update(ctx, targetId, { [field]: c.value });
        const after = await find(targetId);
        const unchanged = isEq({ ...before, updatedAt: 0 }, { ...after, updatedAt: 0 });
        const storedOk = after ? isEq(after[field], c.value) : false;
        const expect = c.label === 'null' ? (spec.required ? 'invalid' : 'any') : c.expect;
        const v = judge(expect, r.status, storedOk, unchanged);
        res.update.push({ name: `수정 · ${field} ${c.label}`, ok: v.ok, detail: `보냄 ${fmt(c.value)} · 기대 ${expect === 'valid' ? '저장' : expect === 'invalid' ? '거절' : '5xx 아님'} · ${v.why}` });
        // 다음 케이스가 깨끗한 상태에서 시작하도록 원래 값으로 되돌린다
        if (!unchanged) await entity.update(ctx, targetId, { [field]: before[field] ?? sampleOf(spec) });
      }
    }
    // 필드 간 규칙 — 정상 상태의 검사 대상을 규칙 위반 상태로 바꿔 달라고 해 본다
    for (const rule of entity.rules || []) {
      const id = newId();
      const start = { ...(rule.validStart ? rule.validStart(entity.base(fields)) : entity.base(fields)), [idField]: id };
      await entity.create(ctx, start);
      created.add(id);
      const before = await find(id);
      const patch = Object.fromEntries(Object.entries(rule.example(entity.base(fields))).filter(([k, val]) => !isEq(before?.[k], val)));
      const r = await entity.update(ctx, id, patch);
      const after = await find(id);
      const v = judge('invalid', r.status, undefined, isEq({ ...before, updatedAt: 0 }, { ...after, updatedAt: 0 }));
      res.update.push({ name: `수정 · 규칙 위반: ${rule.name}`, ok: v.ok, detail: `보냄 ${fmt(patch)} · 기대 거절 · ${v.why}` });
    }
    await cleanup();

    // ── 3. 조합: 목록 필드들의 모든 두 값 짝을 덮는 조합 (정상 값끼리는 전부 받아야 한다)
    const enumFields = Object.fromEntries(Object.entries(fields).filter(([k, s]) => s.type === 'enum' && k !== idField).map(([k, s]) => [k, s.values]));
    for (const row of pairwise(enumFields)) {
      const id = newId();
      const body = { ...entity.base(fields), ...row, [idField]: id };
      const broken = (entity.rules || []).filter(rule => rule.broken(body));
      const expect = broken.length ? 'invalid' : 'valid';
      const r = await entity.create(ctx, body);
      const saved = await find(id);
      if (saved) created.add(id);
      const storedOk = saved ? Object.entries(row).every(([k, v]) => saved[k] === v) : (ok2xx(r.status) ? false : undefined);
      const v = judge(expect, r.status, storedOk, !saved);
      res.combos.push({ name: `조합 · ${Object.values(row).join(' / ')}`, ok: v.ok,
        detail: (broken.length ? `규칙 위반(${broken.map(b => b.name).join(', ')}) · 기대 거절 · ` : '') + v.why });
      if (created.size > 20) await cleanup();
    }
    await cleanup();

    // ── 4. 본문 모양 — 필드 값이 아니라 본문 자체가 이상할 때
    const shapes = [
      ['빈 객체 {}', '{}'], ['배열 []', '[]'], ['문자열 "x"', '"x"'], ['숫자 1', '1'], ['null', 'null'],
      ['깨진 JSON', '{"a":'], ['빈 본문', ''], ['아주 깊은 중첩', '{"a":'.repeat(2000) + '1' + '}'.repeat(2000)],
    ];
    for (const [label, rawBody] of shapes) {
      const before = (await entity.list(ctx)).length;
      const r = await entity.createRaw(ctx, rawBody);
      const after = (await entity.list(ctx)).length;
      const v = judge('invalid', r.status, undefined, before === after);
      res.shapes.push({ name: `등록 본문 · ${label}`, ok: v.ok, detail: v.why });
    }
    // 스키마에 없는 필드 — 받아도 되지만 저장하면 안 된다
    const id = newId();
    const r = await entity.create(ctx, { ...entity.base(fields), [idField]: id, qaUnknownField: 'x' });
    const saved = await find(id);
    if (saved) created.add(id);
    res.shapes.push({ name: '등록 본문 · 스키마 밖 필드', ok: r.status < 500 && !(saved && 'qaUnknownField' in saved),
      detail: saved && 'qaUnknownField' in saved ? '모르는 필드를 그대로 저장한다' : `${r.status} · 저장 안 함` });
  } finally {
    await cleanup();
  }
  return res;
}

/**
 * 인증 매트릭스 — 공개 경로를 뺀 모든 경로 × 메서드 × 가짜 토큰 종류
 * 기대: 전부 401/403. 진짜 토큰으로는 401 이 아니어야 한다 (막힌 게 인증 때문인지 확인)
 */
async function authMatrix(ctx, { routes, publicRoutes = [], bodyFor = () => ({}), realAs = 'owner' }) {
  const pub = publicRoutes.map(r => `${r.method} ${r.path}`);
  const real = ctx.tokens[realAs];
  const variants = [
    ['토큰 없음', null],
    ['엉터리 토큰', 'Bearer qa-garbage-token'],
    ['형식 다른 헤더', `Token ${real || 'x'}`],
    ...(real ? [['서명 변조 토큰', 'Bearer ' + real.slice(0, -2) + (real.slice(-2) === 'AA' ? 'BB' : 'AA')],
                ['내용 변조 토큰', 'Bearer ' + Buffer.from(JSON.stringify({ sid: 'qa', exp: Date.now() + 1e9 })).toString('base64url') + '.' + real.split('.')[1]]] : []),
  ];
  const items = [];
  const PUBLICISH = /(^|\/)(login|signin|logout|register|signup|join|health|healthz|ping|status|csrf|refresh|token|oauth|callback|verify|me|session|whoami|password_reset|password-reset|reset|forgot)(\/|$)/i;
  const same = (a, b) => JSON.stringify(a && a.body) === JSON.stringify(b && b.body);
  const outside = ctx.outsideRoutes || new Set();
  for (const r of routes.filter(r => !pub.includes(`${r.method} ${r.path}`) && !outside.has(`${r.method} ${r.path}`))) {
    const url = r.method === 'DELETE' ? `${r.path}?id=qa-gen-nobody` : r.path;
    const body = ['POST', 'PUT', 'PATCH'].includes(r.method) ? bodyFor(r) : undefined;
    // 읽기 경로는 로그인한 응답과 견준다 — 누구에게나 같은 내용이면 '공개 목록' 일 수 있다 (의도인지 사람이 확인)
    const mine = real && r.method === 'GET' ? await ctx.call(url, { method: 'GET', as: realAs }) : null;
    for (const [label, header] of variants) {
      const res = await ctx.call(url, { method: r.method, as: 'anon', headers: header ? { Authorization: header } : {}, body });
      const blocked = res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400 && /login|signin/i.test(res.location || ''));
      let ok = blocked, detail = blocked ? `${res.status} 차단` : res.status >= 500 ? `${res.status} — 로그인 확인 전에 서버가 죽는다 (로그인 안 한 요청을 401 로 막지 않는다)` : `${res.status} — 인증 없이 통과`;
      if (!blocked && r.method !== 'GET' && res.status < 400 && PUBLICISH.test(r.path)) { ok = true; detail = `${res.status} — 로그인 전에 쓰는 경로 (가입·로그인·비밀번호 찾기)`; }
      else if (!blocked && r.method === 'GET' && res.status < 300) {
        if (PUBLICISH.test(r.path)) { ok = true; detail = `${res.status} — 로그인 상태 확인·발급 경로 (누구나 부른다)`; }
        else if (mine && mine.status < 300 && !same(res, mine)) { ok = true; detail = `${res.status} — 로그인 안 한 사람에겐 다른(공개용) 응답`; }
        else { ok = null; detail = `${res.status} — 로그인 없이 ${mine && mine.status < 300 ? '로그인한 사람과 같은 내용이' : '내용이'} 보인다 — 공개 목록이 맞는지 확인`; }
      } else if (!blocked && res.status >= 400 && res.status < 500 && res.status !== 404) { ok = null; detail = `${res.status} — 인증 전에 입력을 먼저 거절했다 (인증이 걸려 있는지는 이 응답으로 모른다)`; }
      else if (!blocked && res.status === 404) { ok = null; detail = `404 — 없는 대상이라 인증 여부를 알 수 없다`; }
      items.push({ name: `${r.method} ${r.path} · ${label}`, ok, detail });
    }
    if (real && !/logout|signout|withdraw|unregister/i.test(r.path)) {
      const res = mine || await ctx.call(url, { method: r.method, as: realAs, body });
      // 403 은 '로그인은 됐지만 이 역할로는 못 쓴다' 라서 인증 실패가 아니다
      const passes = res.status !== 401;
      items.push({ name: `${r.method} ${r.path} · 진짜 토큰`, ok: passes, detail: passes ? `${res.status}${res.status === 403 ? ' 인증 통과 · 이 역할엔 권한 없음' : ' 인증 통과'}` : `${res.status} — 로그인했는데 막힘` });
    }
  }
  return items;
}

module.exports = { valueCases, sampleOf, pairwise, runEntity, authMatrix, resolveFields };
