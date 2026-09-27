// ============================================================
// 운영 성숙도 — "빠뜨릴 구조인가"
//
// 합격률만으로는 대기업과 1인 개발을 구분할 수 없다. 둘 다 오늘 검사하면 통과할 수 있다.
// 차이는 **내일 누가 먼저 발견하느냐** 다.
//
// 이 프로젝트를 재는 영역들은 "지금 상태가 멀쩡한가"를 본다.
// 여기서는 "멀쩡함이 계속 유지되는 장치가 있는가"를 본다. 둘을 곱해 최종 점수를 낸다.
//
// 항목마다: 왜 중요한가(why) · 무엇을 찾았나(found) · 어떻게 갖추나(how).
// 문서에 이름만 적힌 것은 갖춘 것으로 치지 않는다 — 실제로 돌아가는 설정·스크립트·파일이 있어야 한다.
// 레포가 여러 부분(backend/·frontend/ …)으로 나뉘어 있어도 부분마다 본다.
// ============================================================
const fs = require('fs');
const path = require('path');

// ── 파일 둘러보기 (깊이 5, 설치 폴더 제외)
function walkFiles(dir, out = [], depth = 0) {
  if (depth > 5) return out;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of es) {
    if (['node_modules', '.git', 'reports', '.next', 'dist', 'build', 'venv', '.venv', '__pycache__', 'target', '.gradle'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out, depth + 1); else out.push(p);
  }
  return out;
}
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };

function scan(root, dirs) {
  const files = walkFiles(root);
  const rel = f => path.relative(root, f).split(path.sep).join('/');
  const pkgs = [...new Set([root, ...dirs])].map(d => path.join(d, 'package.json')).filter(f => fs.existsSync(f)).map(f => { try { return { f: rel(f), j: JSON.parse(read(f)) }; } catch (e) { return null; } }).filter(Boolean);
  const reqs = files.filter(f => /(^|\/)(requirements[\w.-]*\.txt|pyproject\.toml|Pipfile)$/.test(rel(f))).map(f => ({ f: rel(f), t: read(f) }));
  const gradle = files.filter(f => /(build\.gradle(\.kts)?|pom\.xml)$/.test(f)).map(f => ({ f: rel(f), t: read(f) }));
  const config = files.filter(f => /\.(json|ya?ml|toml|env|sh|ini|cfg|properties)$/.test(f) || /(^|\/)(Dockerfile|Procfile|Jenkinsfile|Makefile)$/.test(rel(f)) || /\.env\.[\w-]+$/.test(f))
    .filter(f => !/package-lock\.json$|yarn\.lock$|pnpm-lock/.test(f));
  return { root, files, rel, pkgs, reqs, gradle, config };
}
const findFile = (S, re) => S.files.map(S.rel).find(f => re.test(f)) || null;
const findScript = (S, re) => { for (const p of S.pkgs) for (const [k, v] of Object.entries(p.j.scripts || {})) if ((re.test(k) || re.test(v)) && !/no test specified/.test(v)) return `${p.f} 의 "${k}": ${String(v).slice(0, 60)}`; return null; };
const findDep = (S, re) => {
  for (const p of S.pkgs) for (const d of Object.keys({ ...(p.j.dependencies || {}), ...(p.j.devDependencies || {}) })) if (re.test(d)) return `${p.f} 에 ${d}`;
  for (const r of [...S.reqs, ...S.gradle]) { const m = r.t.match(re); if (m) return `${r.f} 에 ${m[0]}`; }
  return null;
};
const findConfig = (S, re) => { for (const f of S.config) { const m = read(f).match(re); if (m) return `${S.rel(f)} 에 ${m[0].slice(0, 40)}`; } return null; };

// ── 항목
const ITEMS = [
  { key: 'ci', weight: 3, label: '푸시할 때마다 자동으로 검사가 돈다 (CI)',
    why: '사람이 기억해서 돌리는 검사는 바쁠 때 빠진다. 깨진 코드가 main 에 들어가기 전에 기계가 막아야 한다.',
    look: '.github/workflows · .gitlab-ci.yml · Jenkinsfile · .circleci · bitbucket-pipelines.yml',
    test: S => findFile(S, /^\.github\/workflows\/.+\.ya?ml$|^\.gitlab-ci\.yml$|(^|\/)Jenkinsfile$|^\.circleci\/|^bitbucket-pipelines\.yml$|^azure-pipelines\.yml$/),
    how: ['GitHub 레포라면 .github/workflows/ci.yml 을 만든다 — 푸시·PR 마다 설치 → 린트 → 테스트 → 빌드를 돌린다',
      'QA 레포의 docs/ci/qa-github-actions.yml 을 복사하면 이 QA 까지 CI 에서 돈다 (새 문제가 생기면 PR 이 빨간색)',
      '레포 Settings → Branches 에서 main 에 "CI 통과해야 머지" 규칙을 건다'] },
  { key: 'tests', weight: 3, label: '레포 안에 자동 테스트가 있다',
    why: '고친 곳이 다른 곳을 깨뜨렸는지 몇 초 만에 알 수 있다. 테스트가 없으면 모든 수정이 도박이다.',
    look: 'package.json 의 test 스크립트 · *.test.* · *.spec.* · tests/ · test_*.py · src/test/',
    test: S => findScript(S, /^test$/) || findFile(S, /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(tests?|__tests__)\/.+\.(py|[jt]sx?)$|(^|\/)test_[\w]+\.py$|_test\.py$|(^|\/)src\/test\/.+\.(java|kt)$/),
    how: ['JS·TS: npm i -D vitest → package.json 에 "test": "vitest run" → 가장 중요한 계산·검증 함수부터 *.test.ts 로',
      '파이썬: pip install pytest → tests/test_*.py (Django 는 앱마다 tests.py 에 TestCase)',
      '자바(Spring): src/test/java 에 @SpringBootTest·@WebMvcTest',
      '처음엔 돈·권한·개인정보를 다루는 함수 3~5개만 — 이 QA 의 ★ 먼저 고칠 것이 좋은 출발점'] },
  { key: 'e2e', weight: 2, label: '화면까지 도는 회귀 검사(E2E·QA)가 CI 에 붙어 있다',
    why: '단위 테스트는 부품만 본다. 실제 화면에서 로그인 → 저장 → 확인이 되는지는 끝까지 돌려 봐야 안다.',
    look: 'playwright.config · cypress.config · e2e/ · CI 에서 이 QA(run.js --ci) 실행',
    test: S => findFile(S, /(^|\/)(playwright|cypress)\.config\.[cm]?[jt]s$|(^|\/)(e2e|cypress)\/|(^|\/)wdio\.conf/) || findConfig(S, /run\.js[^\n]*--ci|ursamajor0714\/(?:QA|[Ww]ebapp-checkup)\b/i),
    how: ['가장 쉬운 길: QA 레포의 docs/ci/qa-github-actions.yml 을 이 레포 .github/workflows/qa.yml 로 복사',
      '직접 만들려면: npm init playwright@latest → 로그인·핵심 저장 흐름 2~3개를 e2e/ 에'] },
  { key: 'monitor', weight: 2, label: '장애를 사람보다 먼저 알려 주는 감시가 있다',
    why: '사용자가 전화로 알려 주기 전에 알아야 한다. 오류 수집(Sentry 등)이나 살아 있는지 두드리는 감시(업타임) 둘 중 하나는 있어야 한다.',
    look: 'sentry·datadog·newrelic·opentelemetry·bugsnag 설치 · SENTRY_DSN · healthchecks.io·uptimerobot·betterstack 설정',
    test: S => findDep(S, /@?sentry[\w/-]*|sentry-sdk|datadog|dd-trace|newrelic|@opentelemetry|opentelemetry|bugsnag|rollbar|logrocket/i) || findConfig(S, /SENTRY_DSN|DATADOG_\w+|healthchecks\.io|uptimerobot|betterstack|statuscake/i),
    how: ['오류 수집: Sentry 무료 계정 → Next.js 는 npx @sentry/wizard -i nextjs, Express 는 @sentry/node, Django 는 pip install sentry-sdk',
      '업타임 감시: UptimeRobot·Better Stack 무료로 /api/health (없으면 만든다) 를 1~5분마다 두드리게 → 죽으면 문자·메일',
      '둘 중 하나만 해도 이 항목은 통과한다'] },
  { key: 'staging', weight: 2, label: '운영과 분리된 시험 환경이 있다',
    why: '운영 DB 에 대고 시험하면 실수 한 번이 실제 사용자 데이터를 망친다. 배포 전에 똑같은 환경에서 한 번 더 본다.',
    look: '.env.staging 같은 환경 파일 · 설정·배포 파일의 staging·preview 환경',
    test: S => findFile(S, /\.env\.(staging|stage|preview)$/) || findConfig(S, /\bstaging\b|environment:\s*(staging|preview)/i),
    how: ['Vercel·Netlify: PR 마다 미리보기 배포가 자동으로 생긴다 — 켜 두고 DB 만 운영과 분리 (preview 용 DATABASE_URL)',
      'Render·Railway·Fly: 같은 서비스를 하나 더 만들어 staging 브랜치에 연결',
      '.env.staging 을 만들어 운영과 다른 DB·키를 쓴다는 것을 코드에 남긴다'] },
  { key: 'docs', weight: 1, label: '결정과 작업 내용이 문서로 남는다',
    why: '왜 이렇게 만들었는지 적어 두지 않으면, 몇 달 뒤 본인도 고치기 무섭다.',
    look: 'docs/ 폴더 · CHANGELOG · ADR',
    test: S => findFile(S, /^(docs|doc|adr|decisions)\/.+\.(md|txt)$|(^|\/)CHANGELOG(\.md)?$/i),
    how: ['docs/ 폴더를 만들고 "무엇을 왜 바꿨는지" 를 날짜별로 한 파일씩 (한 줄이라도)', 'CHANGELOG.md 에 배포마다 바뀐 것을 적는다'] },
  { key: 'deploy', weight: 1, label: '배포 절차가 코드로 적혀 있다',
    why: '배포가 사람 머릿속에만 있으면 그 사람이 없을 때 아무도 못 올린다. 파일로 있으면 누구나 같은 방법으로 올린다.',
    look: 'Dockerfile · docker-compose · Procfile · vercel.json · render.yaml · fly.toml · netlify.toml · app.yaml · k8s',
    test: S => findFile(S, /(^|\/)(Dockerfile|Procfile|docker-compose\.ya?ml|compose\.ya?ml|vercel\.json|render\.ya?ml|fly\.toml|netlify\.toml|app\.ya?ml|railway\.json|nixpacks\.toml)$|(^|\/)(k8s|kubernetes|helm)\//),
    how: ['쓰는 곳에 맞는 설정 파일 하나: Vercel → vercel.json, Render → render.yaml, 서버 직접 → Dockerfile + docker-compose.yml',
      'README 에 배포 방법을 적는 것도 좋지만, 점수는 설정 파일이 있어야 준다'] },
  { key: 'audit', weight: 1, label: '의존성 취약점을 정기적으로 본다',
    why: '어제 안전했던 라이브러리에 오늘 구멍이 발표된다. 사람이 기억해서 npm audit 을 치지 않는다 — 자동이어야 한다.',
    look: '.github/dependabot.yml · renovate.json · CI 의 npm audit·pip-audit·snyk',
    test: S => findFile(S, /^\.github\/dependabot\.ya?ml$|(^|\/)renovate\.json5?$|^\.renovaterc/) || findConfig(S, /npm audit|pip-audit|snyk test|osv-scanner|safety check/i) || findScript(S, /audit/),
    how: ['GitHub: .github/dependabot.yml 을 만든다 (npm·pip·gradle 을 매주 확인 → 업데이트 PR 이 자동으로 온다)', '또는 CI 에 npm audit --omit=dev --audit-level=high 한 줄'] },
  { key: 'backup', weight: 2, label: 'DB 백업·복구 절차가 있다',
    why: '실수로 지운 데이터·해킹·서버 고장 — 백업이 없으면 사업이 끝난다. 복구를 한 번이라도 해 봐야 백업이다.',
    look: 'package.json 의 backup·dump 스크립트 · backup*.sh · pg_dump·mysqldump 가 든 스크립트·설정',
    test: S => findScript(S, /backup|dump/i) || findFile(S, /(^|\/)(backup|restore|dump)[\w-]*\.(sh|js|ts|py|sql)$/i) || findConfig(S, /pg_dump|mysqldump|mongodump|sqlite3 [^\n]*\.backup/),
    how: ['관리형 DB(Neon·Supabase·RDS)면 자동 백업·시점 복구(PITR)가 켜져 있는지 확인하고, 복구 방법을 scripts/restore.md 에',
      '직접 운영하면 scripts/backup.sh (pg_dump … | gzip > backups/$(date +%F).sql.gz) + 매일 cron + 최근 30개 보관',
      'package.json 에 "backup": "bash scripts/backup.sh" — 이 QA 는 실행할 수 있는 스크립트가 있어야 인정한다',
      '분기에 한 번 빈 DB 에 복구해 보는 것까지가 백업이다'] },
  { key: 'rollback', weight: 1, label: '배포를 되돌리는 방법이 적혀 있다',
    why: '배포 뒤 문제가 터지면 고치는 것보다 되돌리는 게 먼저다. 방법을 미리 적어 두지 않으면 급할 때 헤맨다.',
    look: 'rollback*.md·sh · RUNBOOK.md · package.json 의 rollback',
    test: S => findFile(S, /(^|\/)rollback[\w-]*\.(sh|js|md)$|(^|\/)RUNBOOK\.md$|(^|\/)runbook[\w-]*\.md$/i) || findScript(S, /rollback/),
    how: ['docs/rollback.md 에 세 가지: ① 이전 배포로 되돌리는 법 (Vercel: 이전 배포 Promote · Render: Rollback 버튼 · 서버: git checkout 이전태그 후 재시작) ② DB 마이그레이션 되돌리기 ③ 누구에게 알릴지'] },
];

// 성숙도 계수: 0.55 ~ 1.00
// 0 점이어도 0.55 인 이유 — 오늘 검사에서 다 통과한 제품을 "절반 이하"로 깎으면
// 그것대로 거짓말이 된다. 자동화가 없다는 것은 '나빠질 위험' 이지 '이미 나쁨' 이 아니다.
function measure(root, partDirs = []) {
  const S = scan(root, partDirs.filter(Boolean));
  const results = ITEMS.map(i => {
    let found = null; try { found = i.test(S) || null; } catch (e) { found = null; }
    return { key: i.key, weight: i.weight, label: i.label, why: i.why, look: i.look, how: i.how, ok: !!found, found: found ? String(found) : null };
  });
  const total = ITEMS.reduce((s, i) => s + i.weight, 0);
  const got = results.filter(r => r.ok).reduce((s, r) => s + r.weight, 0);
  const ratio = got / total;
  return { items: results, got, total, ratio, factor: 0.55 + 0.45 * ratio };
}

// 갖추면 최종 점수가 얼마나 오르나 — 제품 점수 × 0.45 × 가중치 ÷ 총점
function gains(mat, rawScore) {
  // 제품 점수와 곱하지 않는다 (따로 본다) — 갖추면 성숙도가 몇 점 오르는지
  for (const i of mat.items) if (!i.ok) i.plus = i.weight;
  return mat;
}

module.exports = { measure, gains, ITEMS };
