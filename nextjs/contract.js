// pyroguard2d 의 계약 — API_기능_정의서.txt 의 규칙을 그대로 옮긴다.
// 서버 코드(lib/server/validation.ts)를 베끼지 않는다. 베끼면 서버가 틀려도 같이 틀려서 못 잡는다.
// 규칙이 바뀌면 여기만 고치면 되고, 검사 케이스는 common/contract.js 가 만든다.
const { raw } = require('./helpers');

const sensor = {
  name: '센서',
  idField: 'id',
  idPrefix: 'qa-gen-',
  fields: {
    id: { type: 'string', required: true, max: 80, pattern: /^[A-Za-z0-9_-]{1,80}$/ },
    type: { type: 'enum', required: true, values: ['EXTINGUISHER', 'HYDRANT', 'WATER_PRESSURE', 'ARC', 'LEAK', 'EMERGENCY_DOOR', 'CCTV', 'CUSTOM'] },
    // 층 목록은 서버가 아는 22개 관제 구역 — 하드코딩하지 않고 /api/floors 에서 받는다
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
  // 필드 간 규칙 (API 정의서 [API 3] 비상문 fail-safe)
  rules: [
    { name: '전원 꺼진 비상문은 잠글 수 없다',
      broken: b => b.type === 'EMERGENCY_DOOR' && b.powerStatus === 'OFF' && b.doorState === 'LOCKED',
      example: base => ({ ...base, type: 'EMERGENCY_DOOR', powerStatus: 'OFF', doorState: 'LOCKED' }),
      validStart: base => ({ ...base, type: 'EMERGENCY_DOOR', powerStatus: 'ON', doorState: 'CLOSED' }) },
  ],
  updatable: ['type', 'floorId', 'x', 'y', 'status', 'name', 'customEmoji', 'powerStatus', 'autoCloseDelay', 'doorState', 'value', 'fov'],
  // 정상 본문 — 여기서 필드 하나씩 바꿔 본다. 검사 센서는 CCTV 로 만든다 (비상문 규칙과 엮이지 않게)
  base: () => ({ type: 'CCTV', floorId: '1F', x: 10, y: 10, status: 'NORMAL', name: 'QA 자동검사' }),
  list: async ctx => ((await ctx.call('/api/sensors')).body || { data: [] }).data,
  create: (ctx, body) => ctx.call('/api/sensors', { method: 'POST', body }),
  createRaw: (ctx, text) => raw(ctx, '/api/sensors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text }),
  update: (ctx, id, patch) => ctx.call('/api/sensors', { method: 'PUT', body: { id, ...patch } }),
  remove: (ctx, id) => ctx.call('/api/sensors?id=' + encodeURIComponent(id), { method: 'DELETE' }),
};

// F·E 가 같은 결과를 나눠 쓴다 — 한 번만 돌린다
function sensorContract(ctx) {
  const { runEntity } = require('../common/contract');
  ctx.__sensorContract ??= runEntity(ctx, sensor);
  return ctx.__sensorContract;
}

module.exports = { sensor, sensorContract };
