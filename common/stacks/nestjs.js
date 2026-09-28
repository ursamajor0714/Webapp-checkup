// NestJS — 서버. @Controller('접두어') + @Get(':id') 를 이어 붙이고, main.ts 의 setGlobalPrefix 를 앞에 붙인다.
//   본문 규칙은 @Body() dto: CreateXDto 의 class-validator 데코레이터(@IsString·@MaxLength·@IsEmail …)에서 읽는다 (extract.js)
const path = require('path');
const { walk, read, exists, normParams, joinPath, pkgDeps } = require('./util');

const MAP = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', All: 'ANY' };
const arg = a => { const m = (a || '').match(/['"`]([^'"`]*)['"`]/) || (a || '').match(/path\s*:\s*['"`]([^'"`]*)['"`]/); return m ? m[1] : ''; };
const mainFile = dir => ['src/main.ts', 'src/main.js', 'main.ts'].map(f => path.join(dir, f)).find(exists);

module.exports = {
  id: 'nestjs', label: 'NestJS', kind: 'service', lang: 'js',
  detect: dir => { const d = pkgDeps(dir); return !!(d && d['@nestjs/core']); },
  defaultPort(dir) { const m = read(mainFile(dir) || '').match(/listen\(\s*(?:[^)]*?\?\?|[^)]*?\|\|)?\s*(\d{2,5})/); return m ? Number(m[1]) : 3000; },
  globalPrefix: dir => (read(mainFile(dir) || '').match(/setGlobalPrefix\(\s*['"`]([^'"`]*)['"`]/) || [])[1] || '',
  routes(dir) {
    const out = [];
    const prefix = this.globalPrefix(dir);
    for (const f of walk(path.join(dir, exists(path.join(dir, 'src')) ? 'src' : '.'), ['.ts', '.js']).filter(f => /controller\.[jt]s$/.test(f) || /@Controller\(/.test(read(f)))) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const cls = src.match(/@Controller\(([^)]*)\)/); if (!cls) continue;
      const base = arg(cls[1]);
      const marks = [...src.matchAll(/@(Get|Post|Put|Patch|Delete|All)\(([^)]*)\)/g)];
      marks.forEach((m, i) => {
        const handler = src.slice(m.index, marks[i + 1] ? marks[i + 1].index : m.index + 4000);
        const bodyType = (handler.match(/@Body\(\s*\)\s*\w+\s*:\s*([A-Z]\w*)/) || [])[1];
        out.push({ method: MAP[m[1]], path: normParams(joinPath(prefix, base, arg(m[2]))), file: path.relative(dir, f), handler, bodyType });
      });
    }
    return out;
  },
  serve(dir) {
    const s = ((require('./util').readJson(path.join(dir, 'package.json')) || {}).scripts) || {};
    return { install: ['npm', 'install'], build: ['npm', 'run', 'build'], buildMarker: 'dist/main.js', start: s['start:prod'] ? ['npm', 'run', 'start:prod'] : ['node', 'dist/main'] };
  },
};
