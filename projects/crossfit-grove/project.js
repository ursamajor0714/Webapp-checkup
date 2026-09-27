// CrossFit Grove 관리 시스템 — 코드에서 추정할 수 없는 것만 적는다 (나머지는 범용 감지)
//   배포 뒤 점검:  node projects/crossfit-grove/check-live.js
//   커밋 직전 비밀 검사:  node projects/crossfit-grove/check-staged.js  (대상 레포에서)
module.exports = {
  name: 'CrossFit Grove 관리 시스템',
  // 레포 위치는 화면 ⚙ 설정(.qa-local.json)이나 QA_ROOT 로 준다
  root: process.env.QA_ROOT || '~/Developer/CROSFIT-GROVE',
  // 관리자 비밀번호 하나로 로그인한다 (아이디 없음). 비밀번호는 ⚙ 설정 또는 QA_ADMIN_PW
  auth: { type: 'bearer', loginPath: '/api/admin/login', fields: { password: 'password' }, password: process.env.QA_ADMIN_PW },
  autoAccounts: false,

  // 일부러 열어 둔 경로. "왜 열려 있는지"를 적어 두지 않으면 진짜 구멍과 의도한 공개를 구분할 수 없다.
  publicRoutes: [
    { method: 'POST', path: '/api/admin/login', why: '로그인 자체' },
    { method: 'POST', path: '/api/admin/logout', why: '로그아웃' },
    { method: 'POST', path: '/api/contract/login', why: '계약서 화면 직원 인증' },
    { method: 'POST', path: '/api/member/login', why: '회원 로그인' },
    { method: 'GET', path: '/api/pricing', why: '메인 화면의 가격표 팝업이 로그인 없이 읽는다' },
    { method: 'GET', path: '/api/notices', why: '메인 화면 공지' },
    { method: 'GET', path: '/api/wods/date/:date', why: '메인 화면 오늘의 WOD' },
    { method: 'GET', path: '/api/schedule/events/:year/:month', why: '메인·방문 화면 수업 달력' },
    { method: 'GET', path: '/api/schedule/templates', why: '메인 화면 수업 시간표' },
    { method: 'GET', path: '/api/calendar/events/:year/:month', why: '메인 화면 휴관일 표시' },
    { method: 'POST', path: '/api/applications', why: '방문자가 드랍인·체험을 신청한다' },
    { method: 'POST', path: '/api/holding-requests', why: '회원이 본인 홀딩을 신청한다 (핸들러 안에서 본인 확인)' },
    { method: 'DELETE', path: '/api/holding-requests/:id', why: '회원이 본인 홀딩을 취소한다 (핸들러 안에서 본인 확인)' },
  ],
  // 화면에서 부르지 않지만 일부러 남겨 둔 경로 — '죽은 코드' 와 '아직 화면을 안 만든 기능' 은 다르다
  keptRoutes: [
    { method: 'POST', path: '/api/sms/send', why: '문자 수동 발송. 화면(문자 발송 탭)에 보내기 버튼이 아직 없을 뿐 기능은 살아 있다.' },
  ],
  // check-live.js 가 쓴다
  liveUrl: process.env.QA_LIVE || 'https://cfgrove.com',
  removedRoutes: ['/api/revenue/monthly', '/api/revenue/forecast'],   // 지웠으므로 운영에도 없어야 하는 경로
};
