// ============================================================
// 운영 성숙도 — "빠뜨릴 구조인가"
//
// 합격률만으로는 대기업과 1인 개발을 구분할 수 없다. 둘 다 오늘 검사하면 통과할 수 있다.
// 차이는 **내일 누가 먼저 발견하느냐** 다.
//
// 이 프로젝트를 재는 26개 영역(A~Z)은 "지금 상태가 멀쩡한가"를 본다.
// 여기서는 "멀쩡함이 계속 유지되는 장치가 있는가"를 본다.
// 둘을 곱해야 README 에서 100 을 정의한 문장과 점수가 맞는다.
// ============================================================
const fs = require('fs');
const path = require('path');

const ITEMS = [
  { key: 'ci',        weight: 3, label: '배포할 때마다 자동으로 검사가 돈다 (CI)',
    test: r => exists(r, '.github/workflows') || exists(r, '.gitlab-ci.yml') || exists(r, '.circleci') },
  { key: 'tests',     weight: 3, label: '레포 안에 자동 테스트가 있다',
    test: r => hasTestScript(r) || exists(r, 'test') || exists(r, '__tests__') || globHas(r, /\.(test|spec)\.js$/) },
  { key: 'qaSuite',   weight: 2, label: '이 QA 같은 회귀 검사 도구가 붙어 있다',
    test: r => exists(r, 'qa') || fs.existsSync(path.join(path.dirname(r), 'QA', 'run.js')) },
  { key: 'monitor',   weight: 2, label: '장애를 사람보다 먼저 알려 주는 감시가 있다',
    // 문서에 이름만 적힌 것은 안 센다 — 실제로 설치했거나 설정에 들어 있어야 한다
    test: r => depHas(r, /sentry|datadog|newrelic|opentelemetry/i)
            || grepConfig(r, /SENTRY_DSN|DATADOG_|healthchecks\.io|uptimerobot/i) },
  { key: 'staging',   weight: 2, label: '운영과 분리된 시험 환경이 있다',
    test: r => grepConfig(r, /staging/i) },
  { key: 'docs',      weight: 1, label: '결정과 작업 내용이 문서로 남는다',
    test: r => exists(r, 'docs') },
  { key: 'deploy',    weight: 1, label: '배포 절차가 코드로 적혀 있다',
    test: r => exists(r, 'render.yaml') || exists(r, 'Dockerfile') || exists(r, 'fly.toml') || exists(r, 'vercel.json') },
  { key: 'audit',     weight: 1, label: '의존성 취약점을 정기적으로 본다',
    // 문서에 'npm audit' 이라고 적어 둔 것이 아니라, 자동으로 돌아야 인정한다
    test: r => exists(r, '.github/dependabot.yml') || hasScript(r, /audit/) || grepConfig(r, /renovate|dependabot/i) },
  { key: 'backup',    weight: 2, label: 'DB 백업·복구 절차가 있다',
    // 실행할 수 있는 것이어야 한다 — 스크립트나 예약 작업. 문서에 '백업' 이라고 쓴 것은 절차가 아니다.
    test: r => hasScript(r, /backup|dump/) || globHas(r, /(backup|restore)[\w-]*\.(sh|js|sql)$/)
            || grepConfig(r, /pg_dump/) },
  { key: 'rollback',  weight: 1, label: '배포를 되돌리는 방법이 적혀 있다',
    // DB 트랜잭션의 ROLLBACK 이나 이 QA 보고서의 언급과 구분한다
    test: r => globHas(r, /rollback[\w-]*\.(sh|js|md)$/) || hasScript(r, /rollback/) },
];

function exists(root, rel) { return fs.existsSync(path.join(root, rel)); }
function hasTestScript(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const t = (pkg.scripts || {}).test || '';
    return !!t && !/no test specified/i.test(t);
  } catch (e) { return false; }
}
function walkFiles(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of es) {
    if (['node_modules', '.git', 'reports'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out, depth + 1); else out.push(p);
  }
  return out;
}
function globHas(root, re) { return walkFiles(root).some(f => re.test(path.basename(f))); }

// package.json 의 scripts 에 있는가 — 손으로 기억해 치는 것이 아니라 정해진 명령인가
function hasScript(root, re) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return Object.entries(pkg.scripts || {}).some(([k, v]) => re.test(k) || re.test(v));
  } catch (e) { return false; }
}

// 설정·배포 파일에만 있는가. 문서(.md)에 이름만 적힌 것은 갖춘 것이 아니다.
function grepConfig(root, re) {
  return walkFiles(root)
    .filter(f => /\.(json|yml|yaml|toml|env|sh)$/.test(f) || /^(Dockerfile|Procfile)$/.test(path.basename(f)))
    .some(f => { try { return re.test(fs.readFileSync(f, 'utf8')); } catch (e) { return false; } });
}
function grepAny(root, re) {
  return walkFiles(root)
    .filter(f => /\.(js|json|yml|yaml|md|sh|txt)$/.test(f))
    .some(f => { try { return re.test(fs.readFileSync(f, 'utf8')); } catch (e) { return false; } });
}

// 성숙도 계수: 0.55 ~ 1.00
// 0 점이어도 0.55 인 이유 — 오늘 검사에서 다 통과한 제품을 "절반 이하"로 깎으면
// 그것대로 거짓말이 된다. 자동화가 없다는 것은 '나빠질 위험' 이지 '이미 나쁨' 이 아니다.
function measure(root) {
  const results = ITEMS.map(i => ({ ...i, ok: safe(() => i.test(root)) }));
  const total = ITEMS.reduce((s, i) => s + i.weight, 0);
  const got = results.filter(r => r.ok).reduce((s, r) => s + r.weight, 0);
  const ratio = got / total;
  return { items: results, got, total, ratio, factor: 0.55 + 0.45 * ratio };
}
function safe(fn) { try { return !!fn(); } catch (e) { return false; } }

module.exports = { measure, ITEMS };
