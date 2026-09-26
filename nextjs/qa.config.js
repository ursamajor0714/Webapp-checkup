// QA 대상 설정 — pyroguard2d (Next.js App Router)
const path = require('path');
module.exports = {
  name: 'PyroGuard 2D 방재 관제',
  root: process.env.QA_ROOT || path.resolve(process.env.HOME, 'Developer/pyroguard2d'),   // 대상 레포 위치
  baseUrl: process.env.QA_BASE || 'http://localhost:3000',
  // 로그인이 생긴 뒤에만 쓴다. 로그인 경로가 없는 버전이면 비워 둬도 돈다.
  operatorPassword: process.env.QA_OPERATOR_PW,
  // 119 OTP. 서버의 EMERGENCY_OTP 와 같은 값을 준다.
  // 값을 안 주면 옛 버전에 박혀 있던 값으로 시험한다 — 그 값이 아직 통하는지가 곧 K 의 검사 대상이다.
  otp: process.env.QA_OTP || '119119',
  serverDirs: ['app/api', 'lib'],             // 서버 소스 폴더
  serverExt: ['.ts'],
  clientDirs: ['app', 'components', 'hooks', 'store'],   // 화면 소스 폴더
  clientExt: ['.ts', '.tsx'],
  ignore: ['node_modules', '.git', '.next', 'reports', 'dist', 'build'],
  // 화면 페이지 (H·N·P 가 연다)
  pages: ['/', '/mobile-demo'],
  seedSensorCount: 92,                        // lib 의 시드 센서 수 — 검사 뒤 이 수로 돌아와야 한다

  // 일부러 열어 둔 경로. 근거 없는 항목은 넣지 않는다.
  publicRoutes: [
    { method: 'POST', path: '/api/auth/login',  why: '운영자 로그인 자체' },
    { method: 'POST', path: '/api/auth/logout', why: '로그아웃 (세션을 지우기만 한다)' },
    { method: 'GET',  path: '/api/auth/session', why: '로그인 여부 확인 (로그인 화면 분기)' },
    { method: 'GET',  path: '/api/health',      why: '외부 감시가 살아 있는지 두드리는 곳 (데이터 없음)' },
  ],
  // 화면에서 부르지 않지만 일부러 남겨 둔 경로
  keptRoutes: [
    { method: 'GET', path: '/api/floors', why: '층별 요약 API (외부 연동·점검용). 관제 화면은 센서 목록에서 같은 규칙(lib/floorStatus)으로 직접 집계한다' },
    { method: 'GET', path: '/api/health', why: '외부 업타임 감시가 부른다 — 화면이 부르지 않는 게 정상' },
  ],
};
