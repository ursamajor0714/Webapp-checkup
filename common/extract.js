// ============================================================
// 규칙 자동 추출 — 코드에 이미 적힌 검증 규칙을 읽어 '계약' 으로 바꾼다
//
//   zod                  z.object({ email: z.string().email(), age: z.number().min(0) })  ← Express·Next
//   Bean Validation      @NotBlank @Size(max=20) @Email @Min @Max @Pattern  ← Spring DTO (@RequestBody)
//   pydantic             class X(BaseModel): name: str = Field(..., max_length=20)  ← FastAPI
//   Django 폼·모델        forms.ModelForm(Meta.fields) + models.CharField(max_length=200)
//   req.body 사용         const { title, content } = req.body   ← 스키마가 없을 때 (약한 규칙)
//
// 규칙마다 strict 를 단다:
//   strict=true  검증 스키마가 있다 → 틀린 값은 반드시 거절돼야 한다
//   strict=false 칸 이름만 안다     → 서버가 죽지 않는지만 본다 (5xx 금지)
// ============================================================
const path = require('path');
const { walk, read } = require('./stacks/util');

// ── 괄호 짝 맞춰 잘라 내기
function balanced(src, openAt) {
  const open = src[openAt], close = { '(': ')', '{': '}', '[': ']' }[open];
  let depth = 0, q = null;
  for (let i = openAt; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return src.slice(openAt + 1, i);
  }
  return src.slice(openAt + 1);
}
// 최상위 쉼표로 나누기
function splitTop(s) {
  const out = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i]; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++; if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ── zod
function zodField(expr) {
  const e = expr.replace(/\s+/g, ' ');
  const spec = { required: !/\.optional\(\)|\.nullish\(\)|\.default\(/.test(e), nullable: /\.nullable\(\)|\.nullish\(\)/.test(e) };
  const inner = e.match(/z\.preprocess\([^,]*,\s*(z\..*)\)\s*$/);
  const base = inner ? inner[1] : e;
  if (/z\.(?:coerce\.)?number\(/.test(base)) {
    Object.assign(spec, { type: 'number', integer: /\.int\(\)/.test(base) });
    const mn = base.match(/\.(?:min|gte)\(\s*(-?[\d.]+)/); const mx = base.match(/\.(?:max|lte)\(\s*(-?[\d.]+)/);
    if (/\.positive\(\)/.test(base)) spec.min = 1; if (/\.nonnegative\(\)/.test(base)) spec.min = 0;
    if (mn) spec.min = Number(mn[1]); if (mx) spec.max = Number(mx[1]);
    if (inner) spec.coerce = true;                    // 문자열 숫자도 받는다
  } else if (/z\.enum\(\s*\[/.test(base)) {
    Object.assign(spec, { type: 'enum', values: [...base.match(/z\.enum\(\s*\[([^\]]*)\]/)[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]) });
  } else if (/z\.boolean\(/.test(base)) spec.type = 'boolean';
  else if (/z\.(?:coerce\.)?string\(/.test(base)) {
    spec.type = 'string';
    const mn = base.match(/\.min\(\s*(\d+)/); const mx = base.match(/\.max\(\s*(\d+)/); const ln = base.match(/\.length\(\s*(\d+)/);
    if (mn) spec.min = Number(mn[1]); if (mx) spec.max = Number(mx[1]); if (ln) spec.min = spec.max = Number(ln[1]);
    if (/\.email\(/.test(base)) spec.format = 'email';
    if (/\.url\(/.test(base)) spec.format = 'url';
    if (/\.uuid\(/.test(base)) spec.format = 'uuid';
    const re = base.match(/\.regex\(\s*\/((?:\\\/|[^/])+)\/([gimsuy]*)/); if (re) { try { spec.pattern = new RegExp(re[1], re[2]); } catch { /* 해석 못 하는 정규식 */ } }
    if (spec.min === undefined && spec.required) spec.min = 0;
  } else if (/z\.array\(/.test(base)) spec.type = 'array';
  else if (/z\.object\(/.test(base)) { spec.type = 'object'; spec.fields = zodObject(base.slice(base.indexOf('z.object(') + 8)); }
  else spec.type = 'any';
  return spec;
}
function zodObject(fromParen) {
  const body = balanced(fromParen, fromParen.indexOf('{'));
  const fields = {};
  for (const part of splitTop(body)) {
    const m = part.match(/^\s*['"]?(\w+)['"]?\s*:\s*([\s\S]+)$/);
    if (m) fields[m[1]] = zodField(m[2].trim());
  }
  return fields;
}
function zodSchemas(files) {
  const out = {};
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/(?:const|let|var|export\s+const)\s+(\w+)\s*=\s*z\.object\(/g)) {
      try { out[m[1]] = { fields: zodObject(src.slice(m.index + m[0].length - 1)), source: `zod ${m[1]} (${path.basename(f)})`, strict: true }; } catch { /* 해석 실패는 건너뛴다 */ }
    }
  }
  return out;
}

// ── req.body 에서 읽는 칸 (스키마가 없을 때)
function bodyFieldsFromHandler(handler) {
  const fields = {};
  for (const m of handler.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*req\.body/g)) for (const n of m[1].split(',')) { const k = n.trim().split(/[:=\s]/)[0]; if (/^\w+$/.test(k)) fields[k] = { type: 'any', required: false }; }
  for (const m of handler.matchAll(/req\.body\.(\w+)/g)) fields[m[1]] ??= { type: 'any', required: false };
  // Next.js·Fetch API: const body = await req.json() · const { a, b } = await request.json() · parsed.body.x
  for (const m of handler.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:await\s+\w+\.json\(\)|\w+\.body\b)/g)) for (const n of m[1].split(',')) { const k = n.trim().split(/[:=\s]/)[0]; if (/^\w+$/.test(k)) fields[k] ??= { type: 'any', required: false }; }
  const bodyVars = ['body', ...[...handler.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+\w+\.json\(\)|\w+\.body\b)/g)].map(m => m[1])];
  for (const v of new Set(bodyVars)) for (const m of handler.matchAll(new RegExp(`(?<![\\w.])(?:\\w+\\.)?${v}\\.(\\w+)`, 'g'))) if (!/^(ok|res|length|then|json)$/.test(m[1])) fields[m[1]] ??= { type: 'any', required: false };
  for (const m of handler.matchAll(/(?:request\.POST|request\.data)(?:\.get)?\(\s*['"](\w+)['"]|request\.POST\[['"](\w+)['"]\]/g)) fields[m[1] || m[2]] ??= { type: 'any', required: false };
  // if (!title || !content) 처럼 비었으면 거절하는 칸은 필수
  for (const m of handler.matchAll(/if\s*\(([^)]*)\)\s*(?:\{\s*)?return\s+res\.status\(\s*4\d\d/g)) for (const n of m[1].matchAll(/!\s*(\w+)\b/g)) if (fields[n[1]]) fields[n[1]].required = true;
  return fields;
}

// ── Spring Bean Validation
function javaClassFields(files, name) {
  const f = files.find(x => new RegExp(`\\b(?:class|record)\\s+${name}\\b`).test(read(x)));
  if (!f) return null;
  const src = read(f);
  const fields = {};
  const rec = src.match(new RegExp(`record\\s+${name}\\s*\\(([^)]*(?:\\([^)]*\\)[^)]*)*)\\)`));
  // 칸 선언마다, 바로 앞(이전 ; { } 이후)의 어노테이션 덩어리를 붙인다 — 메시지 안 괄호에도 안 깨지게
  let decls;
  if (rec) decls = splitTop(rec[1]).map(s => s.trim());
  else {
    const clsBody = src.slice(src.search(new RegExp(`\\b(?:class)\\s+${name}\\b`)));
    decls = [];
    for (const m of clsBody.matchAll(/(?:private|protected|public)\s+(?:final\s+)?([\w<>,\s]+?)\s+(\w+)\s*(?:=[^;]*)?;/g)) {
      const before = clsBody.slice(0, m.index);
      const cut = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}'));
      decls.push(`${before.slice(cut + 1).replace(/\s+/g, ' ')} ${m[1]} ${m[2]}`);
    }
  }
  for (const d of decls) {
    const m = d.match(/^([\s\S]*?)\s*([\w<>,]+(?:\s*<[^>]*>)?)\s+(\w+)\s*$/); if (!m) continue;
    const ann = m[1], type = m[2].trim(), key = m[3];
    const spec = { required: /@NotNull|@NotBlank|@NotEmpty/.test(ann) };
    if (/^(int|long|short|Integer|Long|Short|BigInteger)$/.test(type)) Object.assign(spec, { type: 'number', integer: true, required: spec.required || /^(int|long|short)$/.test(type) });
    else if (/^(double|float|Double|Float|BigDecimal)$/.test(type)) spec.type = 'number';
    else if (/^(boolean|Boolean)$/.test(type)) spec.type = 'boolean';
    else if (type === 'String') { spec.type = 'string'; spec.min = /@NotBlank|@NotEmpty/.test(ann) ? 1 : 0; }
    else if (/List|Set|\[\]/.test(type)) spec.type = 'array';
    else if (/LocalDate|Instant|Date|OffsetDateTime/.test(type)) { spec.type = 'string'; spec.format = 'datetime'; }
    else spec.type = 'any';
    const size = ann.match(/@(?:Size|Length)\(([^)]*)\)/); if (size) { const mn = size[1].match(/min\s*=\s*(\d+)/), mx = size[1].match(/max\s*=\s*(\d+)/); if (mn) spec.min = Number(mn[1]); if (mx) spec.max = Number(mx[1]); }
    const mn = ann.match(/@(?:Min|DecimalMin)\(\s*(?:value\s*=\s*)?"?(-?[\d.]+)/), mx = ann.match(/@(?:Max|DecimalMax)\(\s*(?:value\s*=\s*)?"?(-?[\d.]+)/);
    if (mn) spec.min = Number(mn[1]); if (mx) spec.max = Number(mx[1]);
    if (/@Positive\b/.test(ann)) spec.min = 1; if (/@PositiveOrZero/.test(ann)) spec.min = 0;
    if (/@Email/.test(ann)) spec.format = 'email';
    const pat = ann.match(/@Pattern\(\s*regexp\s*=\s*"((?:\\"|[^"])*)"/); if (pat) { try { spec.pattern = new RegExp(pat[1].replace(/\\\\/g, '\\')); } catch { /* 자바 전용 문법 */ } }
    fields[key] = spec;
  }
  return { fields, source: `${name} (${path.basename(f)})`, strict: Object.values(fields).some(x => x.required || x.max !== undefined || x.format || x.pattern) };
}

// ── pydantic
function pydanticFields(files, name) {
  const f = files.find(x => new RegExp(`class\\s+${name}\\s*\\(\\s*BaseModel`).test(read(x)));
  if (!f) return null;
  const src = read(f);
  const body = src.split(new RegExp(`class\\s+${name}\\s*\\([^)]*\\)\\s*:`))[1].split(/\n(?=\S)/)[0];
  const fields = {};
  for (const m of body.matchAll(/^\s+(\w+)\s*:\s*([\w\[\], |]+?)\s*(?:=\s*(.+))?$/gm)) {
    const [, key, type, dflt] = m;
    const spec = { required: dflt === undefined || /Field\(\s*\.\.\./.test(dflt || '') };
    if (/int/.test(type)) Object.assign(spec, { type: 'number', integer: true }); else if (/float/.test(type)) spec.type = 'number';
    else if (/bool/.test(type)) spec.type = 'boolean'; else if (/str/.test(type)) { spec.type = 'string'; spec.min = 0; } else spec.type = 'any';
    if (/Optional|None/.test(type)) spec.required = false;
    const fld = dflt || '';
    const mx = fld.match(/max_length\s*=\s*(\d+)/), mn = fld.match(/min_length\s*=\s*(\d+)/), ge = fld.match(/g[et]\s*=\s*(-?[\d.]+)/), le = fld.match(/l[et]\s*=\s*(-?[\d.]+)/);
    if (mx) spec.max = Number(mx[1]); if (mn) spec.min = Number(mn[1]); if (ge) spec.min = Number(ge[1]); if (le) spec.max = Number(le[1]);
    fields[key] = spec;
  }
  return { fields, source: `${name} (${path.basename(f)})`, strict: true };
}

// ── Django 폼 → 모델 칸 규칙
function djangoForm(dir, handler) {
  const formName = (handler.match(/(\w+Form)\s*\(\s*request\.POST/) || [])[1];
  const forms = walk(dir, ['forms.py']).map(read).join('\n');
  const models = walk(dir, ['models.py']).map(read).join('\n');
  const fields = {};
  const modelSpec = (model, key) => {
    const body = (models.split(new RegExp(`class\\s+${model}\\s*\\(`))[1] || '').split(/\nclass /)[0];
    const m = body.match(new RegExp(`\\b${key}\\s*=\\s*models\\.(\\w+)\\(([^)]*)\\)`));
    if (!m) return { type: 'string', required: true, min: 1 };
    const s = { required: !/blank\s*=\s*True|null\s*=\s*True|default\s*=/.test(m[2]) };
    if (/CharField|TextField|SlugField|EmailField/.test(m[1])) { s.type = 'string'; s.min = s.required ? 1 : 0; const mx = m[2].match(/max_length\s*=\s*(\d+)/); if (mx) s.max = Number(mx[1]); if (m[1] === 'EmailField') s.format = 'email'; }
    else if (/IntegerField|BigIntegerField|PositiveIntegerField/.test(m[1])) Object.assign(s, { type: 'number', integer: true, ...(m[1].startsWith('Positive') ? { min: 0 } : {}) });
    else if (/FloatField|DecimalField/.test(m[1])) s.type = 'number'; else if (/BooleanField/.test(m[1])) s.type = 'boolean'; else s.type = 'any';
    return s;
  };
  if (formName) {
    const fb = (forms.split(new RegExp(`class\\s+${formName}\\s*\\(`))[1] || '').split(/\nclass /)[0];
    const model = (fb.match(/model\s*=\s*(\w+)/) || [])[1];
    const list = (fb.match(/fields\s*=\s*[\[(]([^\])]*)/) || [])[1];
    for (const k of list ? [...list.matchAll(/['"](\w+)['"]/g)].map(m => m[1]) : []) fields[k] = model === 'User' ? { type: 'string', required: true, min: 1, max: 150 } : modelSpec(model, k);
    // UserCreationForm — Django 기본 비밀번호 규칙(8자 이상)
    if (/UserCreationForm/.test(forms.split(new RegExp(`class\\s+${formName}`))[1] || '')) { fields.password1 = { type: 'string', required: true, min: 8 }; fields.password2 = { type: 'string', required: true, min: 8, sameAs: 'password1' }; }
    // clean_<칸>() 안의 손 규칙 — len(x) > N · re.match(r'^…$', x)
    const clsSrc = forms.split(new RegExp(`class\\s+${formName}\\b`))[1] || '';
    const clsBody = clsSrc.split(/\nclass\s/)[0];
    for (const m of clsBody.matchAll(/def\s+clean_(\w+)\s*\([^)]*\):([\s\S]*?)(?=\n\s*def\s|$)/g)) {
      const f = fields[m[1]] || (fields[m[1]] = { type: 'string', required: true });
      const len = m[2].match(/len\(\s*\w+\s*\)\s*>\s*(\d+)/); if (len) f.max = Math.min(f.max ?? Infinity, +len[1]);
      const lmin = m[2].match(/len\(\s*\w+\s*\)\s*<\s*(\d+)/); if (lmin) f.min = +lmin[1];
      const re = m[2].match(/re\.(?:match|fullmatch)\(\s*r?['"]([^'"]+)['"]/); if (re) { try { f.pattern = new RegExp(re[1].startsWith('^') ? re[1] : '^' + re[1]); } catch { /* 파이썬 전용 문법 */ } }
    }
    const mx = fb.match(/len\(\s*(\w+)\s*\)\s*>\s*(\d+)/); if (mx && fields.username) fields.username.max = Number(mx[2]);
    if (/\[A-Za-z0-9\]\+/.test(fb) && fields.username) fields.username.pattern = /^[A-Za-z0-9]+$/;
    return { fields, source: `${formName} (forms.py)`, strict: true, form: true };
  }
  // 폼 없이 request.POST 에서 바로 읽는 뷰 — 같은 이름의 모델 칸이 있으면 그 규칙
  const raw = bodyFieldsFromHandler(handler);
  const model = (handler.match(/([A-Z]\w+)\.objects\.create\(|\b([A-Z]\w+)\(\s*\w+\s*=/) || []).slice(1).find(Boolean);
  for (const k of Object.keys(raw)) fields[k] = model ? modelSpec(model, k) : raw[k];
  return Object.keys(fields).length ? { fields, source: model ? `${model} (models.py)` : 'request.POST', strict: !!model, form: true } : null;
}

/**
 * 서비스의 라우트마다 본문 규칙을 붙인다 → [{ method, path, service, fields, source, strict, form }]
 */
function extractContracts(service, routes, stackId) {
  const dir = service.absDir;
  const out = [];
  if (stackId === 'express' || stackId === 'nextjs') {
    const files = walk(dir, ['.js', '.ts', '.mjs']);
    const zod = zodSchemas(files);
    for (const r of routes) {
      if (!['POST', 'PUT', 'PATCH'].includes(r.method) || !r.handler) continue;
      const used = Object.keys(zod).find(n => new RegExp(`\\b${n}\\.(?:safe)?[pP]arse(?:Async)?\\(|validate\\w*\\(\\s*${n}\\b`).test(r.handler));
      if (used) out.push({ ...r, ...zod[used] });
      else {
        const f = bodyFieldsFromHandler(r.handler);
        const custom = (r.handler.match(/\b(validate\w*|check\w*|assert\w*|parse\w+Body)\(\s*(?:\w+\.)?body\b/) || [])[1]
          || (/if\s*\(\s*typeof\s+\w+(?:\.\w+)*\s*!==?|if\s*\([^)]*!\s*\/[^/\n]+\/[gimsuy]*\.test\(\s*[\w.]+|if\s*\([^)]*\.length\s*[<>]=?\s*\d+/.test(r.handler) && /(?:status|fail)\(\s*4\d\d|status:\s*4\d\d/.test(r.handler) ? '형식 검사(if typeof…)' : null);
        if (Object.keys(f).length || custom) out.push({ ...r, fields: f, source: custom ? `${custom}${custom.includes('(') ? '' : '()'} — 손으로 짠 검증` : 'req.body 사용', strict: false, customValidator: custom || null });
      }
    }
  } else if (stackId === 'spring') {
    const files = walk(dir, ['.java', '.kt']);
    for (const r of routes) {
      if (!r.bodyType) continue;
      const c = javaClassFields(files, r.bodyType); if (c && Object.keys(c.fields).length) out.push({ ...r, ...c });
    }
  } else if (stackId === 'fastapi') {
    const files = walk(dir, ['.py']);
    for (const r of routes) { if (!r.bodyType) continue; const c = pydanticFields(files, r.bodyType); if (c && Object.keys(c.fields).length) out.push({ ...r, ...c }); }
  } else if (stackId === 'django') {
    for (const r of routes) { if (r.method !== 'POST' || !r.handler) continue; const c = djangoForm(dir, r.handler); if (c) out.push({ ...r, ...c }); }
  }
  return out.map(({ handler, ...rest }) => rest);
}

module.exports = { extractContracts, zodSchemas, javaClassFields, pydanticFields, bodyFieldsFromHandler };
