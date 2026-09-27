// pyroguard2d 전용 설정 — 코드에서 추정할 수 없는 것만 적는다 (나머지는 범용 감지)
module.exports = {
  name: 'PyroGuard 2D 방재 관제',
  // 레포 위치는 화면 ⚙ 설정(.qa-local.json)이나 QA_ROOT 로 준다
  root: process.env.QA_ROOT || '~/Developer/pyroguard2d',
  // 운영자 비밀번호 하나로 로그인한다 (아이디 없음). 비밀번호는 ⚙ 설정 또는 QA_OPERATOR_PW
  auth: { type: 'cookie', loginPath: '/api/auth/login', fields: { password: 'password' }, password: process.env.QA_OPERATOR_PW, otp: process.env.QA_OTP },
  autoAccounts: false,   // 가입 경로 없음
  pages: ['/', '/mobile-demo'],   // 전용 검사(P)가 여는 화면
  // 대상 서버를 켤 때 넣는 환경변수 (화면 ⚙ 설정 값 ↔ 대상 키)
  serveEnv: { password: 'OPERATOR_PASSWORD', otp: 'EMERGENCY_OTP', random: ['SESSION_SECRET'] },
  // 일부러 열어 둔 경로 — 근거가 있는 것만
  publicRoutes: [
    { method: 'POST', path: '/api/auth/login', why: '운영자 로그인 자체' },
    { method: 'POST', path: '/api/auth/logout', why: '로그아웃 (세션을 지우기만 한다)' },
    { method: 'GET', path: '/api/auth/session', why: '로그인 여부 확인 (로그인 화면 분기)' },
    { method: 'GET', path: '/api/health', why: '외부 감시가 살아 있는지 두드리는 곳 (데이터 없음)' },
  ],
  // 규칙을 코드에서 읽을 수 없는 자원(손으로 짠 검증 함수) — API 정의서의 규칙을 옮겨 적는다.
  // 서버 코드(lib/server/validation.ts)를 베끼지 않는다: 베끼면 서버가 틀려도 같이 틀려서 못 잡는다.
  // 적어 두면 F 영역이 등록·수정·조합·본문 모양을 수백 건으로 만들어 끝까지 잰다.
  entities: [sensor()],
  keptRoutes: [
    { method: 'GET', path: '/api/floors', why: '층별 요약 API (외부 연동·점검용)' },
    { method: 'GET', path: '/api/health', why: '외부 업타임 감시가 부른다' },
  ],
};

function sensor() {
  const list = async ctx => ((await ctx.call('/api/sensors')).body || { data: [] }).data;
  return {
    name: '센서',
    routes: ['POST /api/sensors', 'PUT /api/sensors'],
    idField: 'id',
    idPrefix: 'qa-gen-',
    fields: {
      id: { type: 'string', required: true, max: 80, pattern: /^[A-Za-z0-9_-]{1,80}$/ },
      type: { type: 'enum', required: true, values: ['EXTINGUISHER', 'HYDRANT', 'WATER_PRESSURE', 'ARC', 'LEAK', 'EMERGENCY_DOOR', 'CCTV', 'CUSTOM'] },
      // 층 목록은 서버가 아는 관제 구역 — /api/floors 에서 받는다
      floorId: { type: 'enum', required: true, valuesFrom: async ctx => ((await ctx.call('/api/floors')).body || { data: [] }).data.map(f => f.id) },
      x: { type: 'number', required: true, min: 0, max: 100 },
      y: { type: 'number', required: true, min: 0, max: 100 },
      status: { type: 'enum', required: true, values: ['NORMAL', 'MAINTENANCE', 'ALARM', 'OFFLINE'] },
      name: { type: 'string', max: 100, min: 0 },
      customEmoji: { type: 'string', max: 16, min: 0 },
      powerStatus: { type: 'enum', values: ['ON', 'OFF'] },
      autoCloseDelay: { type: 'number', integer: true, min: 0, max: 600 },
      doorState: { type: 'enum', values: ['LOCKED', 'UNLOCKED', 'OPENED', 'CLOSED'] },
      value: { type: 'number', min: 0, max: 100000 },
      fov: { type: 'object', fields: {
        distance: { type: 'number', min: 1, max: 100 },
        angle: { type: 'number', min: 1, max: 360 },
        rotation: { type: 'number', min: 0, max: 360 },
      } },
    },
    // 필드 간 규칙 (API 정의서: 비상문 fail-safe)
    rules: [
      { name: '전원 꺼진 비상문은 잠글 수 없다',
        broken: b => b.type === 'EMERGENCY_DOOR' && b.powerStatus === 'OFF' && b.doorState === 'LOCKED',
        example: base => ({ ...base, type: 'EMERGENCY_DOOR', powerStatus: 'OFF', doorState: 'LOCKED' }),
        validStart: base => ({ ...base, type: 'EMERGENCY_DOOR', powerStatus: 'ON', doorState: 'CLOSED' }) },
    ],
    updatable: ['type', 'floorId', 'x', 'y', 'status', 'name', 'customEmoji', 'powerStatus', 'autoCloseDelay', 'doorState', 'value', 'fov'],
    // 정상 본문 — 검사 센서는 CCTV (비상문 규칙과 엮이지 않게)
    base: () => ({ type: 'CCTV', floorId: '1F', x: 10, y: 10, status: 'NORMAL', name: 'QA 자동검사' }),
    list,
    create: (ctx, body) => ctx.call('/api/sensors', { method: 'POST', body, as: 'owner' }),
    createRaw: (ctx, text) => ctx.call('/api/sensors', { method: 'POST', raw: text, headers: { 'Content-Type': 'application/json' }, as: 'owner' }),
    update: (ctx, id, patch) => ctx.call('/api/sensors', { method: 'PUT', body: { id, ...patch }, as: 'owner' }),
    remove: (ctx, id) => ctx.call('/api/sensors?id=' + encodeURIComponent(id), { method: 'DELETE', as: 'owner' }),
  };
}
