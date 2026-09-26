// K. 비밀 노출 — express-ejs 의 K 패턴 + 이 레포의 유일한 비밀인 119 OTP
const { check } = require('../../common/core');
const { raw } = require('../helpers');

module.exports = {
  id: 'K', name: '비밀 노출', weight: 7,
  async run(ctx) {
    const checks = [];
    const patterns = [[/(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{6,}['"]/gi, '비밀번호'], [/sk-[A-Za-z0-9]{20,}/g, 'API 키'],
      [/AKIA[0-9A-Z]{16}/g, 'AWS 키'], [/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '개인키']];
    const files = ctx.files(['app', 'components', 'hooks', 'store', 'lib', 'types'], ['.ts', '.tsx', '.json', '.md']);
    const hits = [];
    for (const f of files) {
      const s = ctx.readAbs(f);
      for (const [re, w] of patterns) for (const m of s.matchAll(re)) if (!/process\.env/.test(m[0])) hits.push(`${ctx.rel(f)}: ${w}`);
    }
    checks.push(check('코드에 비밀번호·키가 박혀 있지 않다', { universe: files.length, scanned: files.length,
      passed: files.length - new Set(hits.map(h => h.split(':')[0])).size, notes: hits }));
    // OTP 가 코드·화면에 박혀 있는가 — 6자리 숫자 리터럴을 OTP 와 비교하거나 화면에 보여 주는 꼴
    const otpFiles = files.filter(f => /otp[^\n]{0,40}['"`]\d{6}['"`]|['"`]\d{6}['"`][^\n]{0,40}otp|\b119119\b/i.test(ctx.readAbs(f))).map(f => ctx.rel(f));
    checks.push(check('OTP 가 코드·화면에 박혀 있지 않다 (환경변수)', { universe: files.length, scanned: files.length, passed: files.length - otpFiles.length,
      notes: otpFiles.map(f => `${f} 에 OTP 값이 있다`) }));
    // 틀린 OTP 응답이 정답을 알려 주는가 + 계속 틀려도 계속 받아 주는가 (attacker 단말로)
    const tries = []; for (let i = 0; i < 12; i++) tries.push(await raw(ctx, '/api/emergency',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp: String(100000 + i) }) }, 'attacker'));
    const hint = !!ctx.config.otp && tries.some(t => t.text.includes(ctx.config.otp));
    checks.push(check('실패 응답이 정답을 알려 주지 않는다', { universe: 1, scanned: 1, passed: hint ? 0 : 1,
      notes: hint ? ['OTP 가 틀리면 응답 message 에 정답을 그대로 적어 돌려준다'] : [] }));
    const locked = tries.slice(5).every(t => t.status === 429 || t.status === 423);
    checks.push(check('OTP 를 연달아 틀리면 잠긴다 (무차별 대입 방지)', { universe: 1, scanned: 1, passed: locked ? 1 : 0,
      notes: locked ? [] : [`12번 연속 오답이 전부 ${[...new Set(tries.map(t => t.status))].join('/')} — 6자리는 백만 가지뿐이라 제한 없이는 금방 뚫린다`] }));
    const gi = ctx.exists('.gitignore') ? ctx.read('.gitignore') : '';
    checks.push(check('.env 가 깃 추적에서 빠져 있다', { universe: 1, scanned: 1, passed: /^\.env/m.test(gi) ? 1 : 0 }));
    return { checks };
  },
};
