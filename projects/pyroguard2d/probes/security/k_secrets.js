// K (pyroguard2d 전용 덧붙임) — 이 레포의 핵심 비밀인 119 OTP. 박힌 비밀·.env 추적은 범용 K 가 본다
const { check } = require('../../../../common/core');
const { owasp } = require('../../../../common/areas/_util');
const { raw } = require('../../helpers');

module.exports = {
  id: 'K', name: '비밀 노출', weight: 7,
  async run(ctx) {
    const checks = [];
    const files = ctx.files(['app', 'components', 'hooks', 'store', 'lib', 'types'], ['.ts', '.tsx', '.json', '.md']);
    // OTP 가 코드·화면에 박혀 있는가 — 6자리 숫자 리터럴을 OTP 와 비교하거나 화면에 보여 주는 꼴
    const otpFiles = files.filter(f => /otp[^\n]{0,40}['"`]\d{6}['"`]|['"`]\d{6}['"`][^\n]{0,40}otp|\b119119\b/i.test(ctx.readAbs(f))).map(f => ctx.rel(f));
    checks.push(owasp('A02', check('OTP 가 코드·화면에 박혀 있지 않다 (환경변수)', { universe: files.length, scanned: files.length, passed: files.length - otpFiles.length,
      notes: otpFiles.map(f => `${f} 에 OTP 값이 있다`) })));
    // 틀린 OTP 응답이 정답을 알려 주는가 + 계속 틀려도 계속 받아 주는가 (attacker 단말로)
    const tries = []; for (let i = 0; i < 12; i++) tries.push(await raw(ctx, '/api/emergency',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ otp: String(100000 + i) }) }, 'attacker'));
    const hint = !!ctx.project.auth.otp && tries.some(t => t.text.includes(ctx.project.auth.otp));
    checks.push(owasp('A07', check('실패 응답이 정답을 알려 주지 않는다', { universe: 1, scanned: 1, passed: hint ? 0 : 1,
      notes: hint ? ['OTP 가 틀리면 응답 message 에 정답을 그대로 적어 돌려준다'] : [] })));
    const locked = tries.slice(5).every(t => t.status === 429 || t.status === 423);
    checks.push(owasp('A07', check('OTP 를 연달아 틀리면 잠긴다 (무차별 대입 방지)', { universe: 1, scanned: 1, passed: locked ? 1 : 0,
      notes: locked ? [] : [`12번 연속 오답이 전부 ${[...new Set(tries.map(t => t.status))].join('/')} — 6자리는 백만 가지뿐이라 제한 없이는 금방 뚫린다`] })));
    return { checks };
  },
};
