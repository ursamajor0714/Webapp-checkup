#!/usr/bin/env node
// PHP 앱을 Docker 로 켠다 — 이 맥에 PHP·MySQL 이 없어도 된다
//   node php-run.js <레포 폴더> <포트> <codeigniter|php>
//   · PHP 이미지(qa-php:8.2 — intl·mysqli·pdo_mysql·composer)를 한 번 만든다
//   · MySQL 을 옆에 띄운다 — 데이터는 메모리(tmpfs)에만: 켤 때마다 비어 있고, 끄면 흔적이 없다
//   · 코드가 원격 DB 주소(예: db.example.com)를 가리키면 그 이름이 **로컬 MySQL** 을 가리키게 한다 (코드는 안 바꾼다)
//     → 검사가 만든 데이터가 진짜 DB 로 가지 않는다. 계정·비밀번호도 코드의 것과 같게 로컬에 만든다
//   · 표 만들기: CodeIgniter 는 php spark migrate, 순수 PHP 는 migrate.php 가 있으면 그것
//   · 이 프로세스가 끝나면(QA 가 서버를 끄면) 컨테이너를 모두 지운다
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const [dir, port, kind] = process.argv.slice(2);
if (!dir || !port) { console.error('사용법: node php-run.js <레포> <포트> <codeigniter|php>'); process.exit(2); }
const QA = path.resolve(__dirname, '..', '..');
const tag = crypto.createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 8);
const work = path.join(QA, '.qa-data', 'php', tag);
fs.mkdirSync(work, { recursive: true });
const project = `qa-php-${tag}`;
const log = m => console.log(`[QA php] ${m}`);
const sh = (cmd, args, opt = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opt });

// 1) PHP 이미지
const IMAGE = 'qa-php:8.2-2';   // 이미지 내용을 바꾸면 태그를 올린다 (다시 만들게)
try { execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }); }
catch {
  log('PHP 이미지를 처음 만든다 (몇 분 걸린다 — 다음부터는 바로 뜬다)');
  fs.writeFileSync(path.join(work, 'Dockerfile'), [
    'FROM php:8.2-cli',
    'RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev libzip-dev unzip git default-mysql-client && docker-php-ext-install intl mysqli pdo_mysql zip && rm -rf /var/lib/apt/lists/*',
    'COPY --from=composer:2 /usr/bin/composer /usr/bin/composer',
    // 기본 이미지는 X-Powered-By: PHP/8.x 를 붙인다 — 운영의 php.ini 는 모르므로 QA 환경 탓으로 걸리지 않게 끈다
    'RUN echo "expose_php = Off" > /usr/local/etc/php/conf.d/qa.ini',
  ].join('\n'));
  sh('docker', ['build', '-t', IMAGE, work]);
}

// 2) 코드가 쓰는 DB 설정 — 순수 PHP 는 $host·$dbname·$user·$pass 나 define('DB_…') 를 읽는다
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
function plainDb() {
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (/^(\.|vendor|node_modules)/.test(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.php$/.test(e.name)) files.push(f); } };
  walk(dir);
  const src = files.filter(f => /mysqli_connect|new\s+(?:mysqli|PDO)\s*\(/.test(read(f)) || /db|database|config/i.test(path.basename(f))).map(read).join('\n');
  const v = re => (src.match(re) || [])[1];
  return {
    host: v(/\$(?:host|db_?host|servername|hostname)\s*=\s*['"]([^'"]+)['"]/i) || v(/define\(\s*['"]DB_HOST['"]\s*,\s*['"]([^'"]+)['"]/) || 'localhost',
    name: v(/\$(?:dbname|db_?name|database)\s*=\s*['"]([^'"]+)['"]/i) || v(/define\(\s*['"]DB_NAME['"]\s*,\s*['"]([^'"]+)['"]/) || 'app',
    user: v(/\$(?:user|username|db_?user)\s*=\s*['"]([^'"]+)['"]/i) || v(/define\(\s*['"]DB_USER['"]\s*,\s*['"]([^'"]+)['"]/) || 'root',
    pass: v(/\$(?:pass|password|db_?pass(?:word)?)\s*=\s*['"]([^'"]*)['"]/i) ?? v(/define\(\s*['"]DB_PASS(?:WORD)?['"]\s*,\s*['"]([^'"]*)['"]/) ?? '',
  };
}
const db = kind === 'codeigniter' ? { host: 'db', name: 'app', user: 'app', pass: 'qa-app-pw' } : plainDb();
const local = /^(localhost|127\.0\.0\.1)$/.test(db.host);
if (!local && db.host !== 'db') log(`코드의 DB 주소 ${db.host} 를 로컬 MySQL 로 돌린다 — 진짜 DB 에는 닿지 않는다`);

// 2-1) 앱이 자기 도메인(Host)만 받는가 — 커스텀 도메인 기능 등 (private const OWN_HOST = 'x.com' · if ($host === 'x.com'))
//   그러면 QA 가 부르는 localhost 는 404 다. 작은 중계기가 Host 를 그 도메인으로 바꿔 넘긴다
function ownHost() {
  const files = [];
  const walk = d => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (/^(\.|vendor|node_modules|writable|tests?)$/.test(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.php$/.test(e.name)) files.push(f); } };
  walk(dir);
  for (const f of files) { const m = read(f).match(/(?:const\s+\w*HOST\w*\s*=|\$host\s*[!=]==?)\s*['"]([a-z0-9-]+(?:\.[a-z0-9-]+)+)['"]/i); if (m && !/^(localhost|127\.0\.0\.1)$/.test(m[1])) return m[1]; }
  return null;
}
const host = ownHost();
const appPort = host ? String(Number(port) + 17) : port;   // 중계기가 있으면 앱은 옆 포트, QA 는 원래 포트로
if (host) log(`앱이 ${host} 도메인만 받는다 — 중계기가 localhost:${port} → 앱(${appPort}) 으로 넘기며 Host 를 ${host} 로 바꾼다`);

// 3) compose — db 는 메모리에만, 이름(원격 주소)은 로컬 db 로
const q = s => JSON.stringify(String(s));
const rootPw = 'qa-root-pw';
const userLines = db.user === 'root' ? (db.pass ? [`      MYSQL_ROOT_PASSWORD: ${q(db.pass)}`] : ['      MYSQL_ALLOW_EMPTY_PASSWORD: "yes"']) : [`      MYSQL_ROOT_PASSWORD: ${q(rootPw)}`, `      MYSQL_USER: ${q(db.user)}`, `      MYSQL_PASSWORD: ${q(db.pass)}`];
const setup = kind === 'codeigniter'
  ? ['[ -d vendor ] || composer install --no-interaction --no-progress --prefer-dist', 'php spark migrate --all -n || php spark migrate -n || true', 'php spark serve --host 0.0.0.0 --port 8080']
  : [...(fs.existsSync(path.join(dir, 'composer.json')) ? ['[ -d vendor ] || composer install --no-interaction --no-progress --prefer-dist'] : []),
    ...['cron/migrate.php', 'migrate.php', 'scripts/migrate.php'].filter(f => fs.existsSync(path.join(dir, f))).map(f => `php ${f} || true`),
    'php -S 0.0.0.0:8080 -t /app'];
const env = kind === 'codeigniter' ? {
  CI_ENVIRONMENT: 'development', 'app.baseURL': `http://localhost:${port}/`,
  'database.default.hostname': 'db', 'database.default.database': db.name, 'database.default.username': db.user, 'database.default.password': db.pass, 'database.default.DBDriver': 'MySQLi', 'database.default.port': '3306',
  'encryption.key': 'hex2bin:' + crypto.randomBytes(32).toString('hex'),
} : {};
// CodeIgniter 는 점이 든 이름(database.default.hostname)을 읽는데, 셸이 그런 환경변수를 버린다 — 만든 .env 를 컨테이너 안에만 덮어 씌운다 (레포 폴더는 안 바꾼다)
const envFile = path.join(work, 'ci.env');
if (kind === 'codeigniter') fs.writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k} = ${/\s/.test(v) ? JSON.stringify(v) : v}`).join('\n') + '\n');
// MariaDB 전용 문법(ADD COLUMN IF NOT EXISTS 등)을 쓰거나 MariaDB 라고 적었으면 MariaDB 로 띄운다
const allPhp = (() => { const out = []; const w = d => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (/^(\.|vendor|node_modules|writable)/.test(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) w(f); else if (/\.(php|sql|md)$/.test(e.name)) out.push(read(f)); } }; w(dir); return out.join('\n'); })();
const DB_IMAGE = /mariadb|ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS|CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i.test(allPhp) ? 'mariadb:11' : 'mysql:8.0';
if (DB_IMAGE.startsWith('mariadb')) log('코드가 MariaDB 문법을 써서 MariaDB 로 띄운다');
const compose = [
  'services:',
  '  db:',
  `    image: ${DB_IMAGE}`,
  '    tmpfs: [/var/lib/mysql]',
  '    environment:',
  `      MYSQL_DATABASE: ${q(db.name)}
      MARIADB_DATABASE: ${q(db.name)}`,
  ...userLines,
  `    healthcheck: { test: ["CMD", ${DB_IMAGE.startsWith('mariadb') ? '"healthcheck.sh", "--connect", "--innodb_initialized"' : '"mysqladmin", "ping", "-h", "127.0.0.1"'}], interval: 2s, timeout: 3s, retries: 60 }`,
  ...(local ? ['    volumes: [sock:/var/run/mysqld]'] : ['    networks:', '      default:', `        aliases: [${q(db.host)}]`]),
  '  app:',
  `    image: ${IMAGE}`,
  '    working_dir: /app',
  `    volumes: [${q(path.resolve(dir) + ':/app')}${kind === 'codeigniter' ? ', ' + q(envFile + ':/app/.env:ro') : ''}${local ? ', "sock:/var/run/mysqld"' : ''}]`,
  ...(local ? ['    network_mode: service:db'] : [`    ports: [${q(appPort + ':8080')}]`]),
  '    depends_on: { db: { condition: service_healthy } }',
  '    environment:',
  ...Object.entries(env).map(([k, v]) => `      ${q(k)}: ${q(v)}`),
  ...(Object.keys(env).length ? [] : ['      QA: "1"']),
  `    command: ["sh", "-c", ${q(setup.join(' && '))}]`,
  ...(local ? ['volumes: { sock: {} }'] : []),
];
// localhost 로 붙는 앱은 db 컨테이너와 네트워크를 같이 쓰므로 포트는 db 쪽에서 연다
if (local) { const i = compose.indexOf('    tmpfs: [/var/lib/mysql]'); compose.splice(i, 0, `    ports: [${q(appPort + ':8080')}]`); }
const file = path.join(work, 'compose.yml');
fs.writeFileSync(file, compose.join('\n') + '\n');
log(`docker compose -p ${project} — 앱 ${kind} · DB ${db.name}${local ? ' (localhost 소켓 공유)' : ''}`);

// 4) 켜고, 꺼질 때 모두 지운다
const down = () => { try { execFileSync('docker', ['compose', '-p', project, '-f', file, 'down', '-v', '--remove-orphans'], { stdio: 'ignore', timeout: 60000 }); } catch { /* 이미 없다 */ } };
down();
// 중계기 — Host 를 앱의 도메인으로 바꿔 넘긴다 (Location 의 그 도메인은 다시 localhost 로)
if (host) {
  const http = require('http');
  var server = http.createServer((req, res) => {
    const p = http.request({ host: '127.0.0.1', port: appPort, path: req.url, method: req.method, headers: { ...req.headers, host } }, r => {
      const h = { ...r.headers };
      if (h.location) h.location = String(h.location).replace(new RegExp(`^(https?:)?//${host.replace(/\./g, '\\.')}(:\\d+)?`), `http://localhost:${port}`);
      res.writeHead(r.statusCode, h); r.pipe(res);
    });
    p.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(p);
  });
  // 앱이 답하기 시작한 뒤에야 문을 연다 — 먼저 열면 QA 가 중계기의 502 를 보고 '켜졌다' 고 여겨 앱이 뜨기 전에 가입을 시도한다
  const waitApp = () => http.get({ host: '127.0.0.1', port: appPort, path: '/', headers: { host } }, r => { r.resume(); relay.listen(Number(port), () => log(`중계기 준비 — localhost:${port}`)); }).on('error', () => setTimeout(waitApp, 1000));
  var relay = server; waitApp();
}
const up = spawn('docker', ['compose', '-p', project, '-f', file, 'up', '--abort-on-container-exit', '--exit-code-from', 'app'], { stdio: 'inherit' });
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; log('끄는 중 — 컨테이너와 DB 를 지운다'); up.kill('SIGINT'); setTimeout(() => { down(); process.exit(0); }, 3000); };
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('SIGHUP', stop);
up.on('exit', code => { down(); process.exit(code || 0); });
