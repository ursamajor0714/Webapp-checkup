// QA 대상 설정. 다른 프로젝트를 재려면 여기만 바꾼다.
const path = require('path');
module.exports = {
  name: 'CrossFit Grove 관리 시스템',
  root: path.resolve(process.env.HOME, 'Developer/CROSFIT-GROVE'),
  baseUrl: process.env.QA_BASE || 'http://localhost:3000',
  adminPassword: process.env.QA_ADMIN_PW,
  // 소스를 찾을 곳 (스캔 모집단을 정할 때 쓴다)
  serverDirs: ['backend'],
  clientDirs: ['frontend/public/js', 'frontend/views'],
  ignore: ['node_modules', '.git', 'reports'],
  // 도커 Postgres 컨테이너 이름 (없으면 DB 직접 조회 검사는 건너뛴다)
  dbContainer: process.env.QA_DB || 'grove-pg',
  dbName: 'grove',
  dbUser: 'postgres',

  // 일부러 열어 둔 경로. "왜 열려 있는지"를 여기 적어 두지 않으면
  // 진짜 구멍과 의도한 공개를 구분할 수 없다. 근거 없는 항목은 넣지 않는다.
  publicRoutes: [
    { method: 'POST', path: '/api/admin/login',    why: '로그인 자체' },
    { method: 'POST', path: '/api/admin/logout',   why: '로그아웃' },
    { method: 'POST', path: '/api/contract/login', why: '계약서 화면 직원 인증' },
    { method: 'POST', path: '/api/member/login',   why: '회원 로그인' },
    { method: 'GET',  path: '/api/pricing',        why: '메인 화면의 가격표 팝업이 로그인 없이 읽는다' },
    { method: 'GET',  path: '/api/notices',        why: '메인 화면 공지' },
    { method: 'GET',  path: '/api/wods/date/:date',why: '메인 화면 오늘의 WOD' },
    { method: 'GET',  path: '/api/schedule/events/:year/:month', why: '메인·방문 화면 수업 달력' },
    { method: 'GET',  path: '/api/schedule/templates', why: '메인 화면 수업 시간표' },
    { method: 'GET',  path: '/api/calendar/events/:year/:month', why: '메인 화면 휴관일 표시' },
    { method: 'POST', path: '/api/applications',   why: '방문자가 드랍인·체험을 신청한다' },
    { method: 'POST', path: '/api/holding-requests', why: '회원이 본인 홀딩을 신청한다 (핸들러 안에서 본인 확인)' },
    { method: 'DELETE', path: '/api/holding-requests/:id', why: '회원이 본인 홀딩을 취소한다 (핸들러 안에서 본인 확인)' },
  ],

  // 화면에서 부르지 않지만 일부러 남겨 둔 경로.
  // '죽은 코드' 와 '아직 화면을 안 만든 기능' 은 다르다. 후자는 지우면 기능이 사라진다.
  // 배포된 사이트 (node check-live.js 가 본다)
  liveUrl: process.env.QA_LIVE || 'https://cfgrove.com',
  // 지웠으므로 운영에도 없어야 하는 경로
  removedRoutes: ['/api/revenue/monthly', '/api/revenue/forecast'],

  keptRoutes: [
    { method: 'POST', path: '/api/sms/send',
      why: '문자 수동 발송. 화면(문자 발송 탭)에 보내기 버튼이 아직 없을 뿐 기능은 살아 있다.' },
  ],
};
