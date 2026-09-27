// 소스를 고치고(커밋 안 함) 다시 켜면 다시 빌드하는가 / 패키지를 추가하면 설치하는가
const path = require('path'), fs = require('fs');
const QA = path.join(process.env.HOME, 'Developer/QA');
const serve = require(path.join(QA, 'common/serve'));
const { loadProject } = require(path.join(QA, 'common/project'));
// 가짜 Next 프로젝트를 임시 폴더에 만든다 — package.json 에 next 가 있으면 QA 는 Next.js 로 본다
const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fakenext-'));
const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); };
w('package.json', JSON.stringify({ name: 'fakenext', private: true, scripts: { build: 'node build.js', start: 'node start.js' }, dependencies: { next: '0.0.0' } }));
w('node_modules/.keep', '');
w('app/page.js', "export default function Page(){ return 'v1' }");
w('build.js', "const fs = require('fs'); fs.mkdirSync('.next', { recursive: true }); fs.writeFileSync('.next/BUILD_ID', String(Date.now())); fs.writeFileSync('.next/page.txt', fs.readFileSync('app/page.js', 'utf8'));");
w('start.js', "require('http').createServer((q, r) => r.end(require('fs').readFileSync('.next/page.txt', 'utf8'))).listen(process.env.PORT);");
require('child_process').execFileSync('sh', ['-c', 'git init -q && git add -A && git -c user.email=qa@x -c user.name=qa commit -qm v1'], { cwd: root });
const def = { id: 'fakenext-' + Date.now(), root };
const once = async label => {
  const part = loadProject(def).parts[0];
  const st = serve.newState();
  await serve.startPart(def, part, st);
  const body = st.phase === 'running' ? await fetch(part.baseUrl).then(r => r.text()).catch(() => '(응답 없음)') : `(켜지 못함: ${st.error})`;
  serve.stop(st); await new Promise(r => setTimeout(r, 800));
  const steps = st.log.filter(l => l.startsWith('$ ')).join(' | ');
  console.log(`${label}: 화면 "${body.trim()}" · 실행한 것: ${steps}`);
};
(async () => {
  console.log('부분:', JSON.stringify(loadProject(def).parts.map(p => [p.stack, p.baseUrl])));
  await once('1. 처음');
  fs.writeFileSync(path.join(root, 'app/page.js'), "export default function Page(){ return 'v2 (고침, 커밋 안 함)' }");
  await once('2. 소스 고친 뒤');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); pkg.dependencies['left-pad'] = '^1.3.0'; fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  await once('3. 패키지 추가한 뒤');
  process.exit(0);
})();
