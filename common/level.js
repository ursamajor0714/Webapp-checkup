// 검사 수준 — 초급 · 중급 · 고급 · 전문가(현역)
//   같은 레포라도 "어디까지 보느냐" 가 다르다. 수준이 오를수록 보는 영역이 늘고, 여는 화면·누르는 버튼이 많아지고, 판정이 엄해진다.
//   초급   : 기본기 — 뜨는가, 터지는가, 비밀이 새는가, 남의 데이터가 보이는가 (빠르다)
//   중급   : 서비스 품질 — 입력 검증·응답 규격·접근성·보안 헤더·로그·개인정보까지
//   고급   : 전체 영역 (기본값) — 동시성·상태 전이·기능 간섭·업무 흐름 같은 복합 검사까지
//   전문가 : 고급 + 두 배로 넓게 + 엄한 판정 — '확인 필요(△)' 도 감점, 접근성 '보통' 위반·느린 API(보통 0.5초) 도 문제로 센다.
//            현역 리뷰어가 출시 전에 보는 기준. △ 는 고치거나 [무시] 에 이유를 적어야 점수가 오른다
const LEVELS = {
  basic: {
    id: 'basic', label: '초급', desc: '기본기 — 뜨는가·터지는가·비밀이 새는가·남의 데이터가 보이는가',
    areas: ['1', '2', '3', '4', '6', 'G', 'N', 'A', 'E', 'F', 'K', 'B', 'C', 'I'], scale: 0.5, strict: false,
  },
  standard: {
    id: 'standard', label: '중급', desc: '서비스 품질 — 입력 검증·응답 규격·접근성·보안 헤더·로그·개인정보',
    areas: ['1', '2', '3', '4', '5', '6', '7', '9', '10', 'G', 'N', 'U', 'Z', 'A', 'J', 'D', 'E', 'F', 'L', 'M', 'O', 'Q', 'T', 'K', 'B', 'C', 'H', 'I', 'P', 'V'], scale: 0.75, strict: false,
  },
  advanced: { id: 'advanced', label: '고급', desc: '전체 영역 — 동시성·상태 전이·기능 간섭·업무 흐름·장애 대응까지', areas: null, scale: 1, strict: false },
  expert: { id: 'expert', label: '전문가', desc: '현역 출시 기준 — 두 배로 넓게, 확인 필요(△)도 감점, 접근성·속도 기준을 엄하게', areas: null, scale: 2, strict: true },
};
const ALIAS = { 초급: 'basic', 중급: 'standard', 고급: 'advanced', 전문가: 'expert', 현역: 'expert', beginner: 'basic', intermediate: 'standard', full: 'advanced', pro: 'expert' };
const DEFAULT = 'advanced';

function levelOf(name) {
  const k = String(name || DEFAULT).trim().toLowerCase();
  const L = LEVELS[k] || LEVELS[ALIAS[k]] || LEVELS[ALIAS[String(name || '').trim()]];
  if (!L) throw new Error(`없는 검사 수준: ${name} (basic·standard·advanced·expert 또는 초급·중급·고급·전문가)`);
  // n(기본 한도) — 이 수준에서 여는 화면·누르는 버튼 수
  return { ...L, n: base => Math.max(1, Math.round(base * L.scale)), includes: id => !L.areas || L.areas.includes(String(id)) };
}

module.exports = { LEVELS, DEFAULT, levelOf };
