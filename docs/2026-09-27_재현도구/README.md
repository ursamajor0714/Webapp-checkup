# 2026-09-27 전체 점검 재현 도구

`../2026-09-27_QA_전체점검.md` 의 [재현] 항목을 다시 확인하는 도구. QA 폴더 안에서 한 줄씩 친다.

```bash
cd docs/2026-09-27_재현도구/sidefx && npm install && cd ..
node verify.js normal --pw=right-pw                          # 문자 발송·남은 데이터·로그아웃·잠금 (P0-1·2·3)
node verify.js wrongpw --pw=wrong --only=1,2,3,G,A,F,E       # 비밀번호가 틀릴 때 로그인 실패 횟수 (P0-5)
node verify.js hang --pw=right-pw --only=Z --env=HANG=1 --wall=150    # 응답 안 하는 경로에서 멈추는가 (P0-6)
node verify.js flaky --pw=right-pw --only=R --env=FLAKY=1    # 끊긴 POST 를 다시 보내 중복이 생기는가 (P0-6)
node stale.js                                                # 고친 소스·추가한 패키지를 반영하는가 (P1-8·9)
```

- `sidefx/server.js` — 부작용을 `$TMPDIR/qa-sidefx-out/` 에 기록하는 시험 서버 (실제 문자는 보내지 않는다). 포트 3456
- `QA_DIR=<다른 QA 폴더>` 를 주면 고친 QA 사본으로 같은 시험을 돌린다
- 고친 뒤 이 서버를 `tests/fixtures/` 로 옮겨 회귀 테스트에 넣으면 같은 문제가 다시 생기지 않는다

## 고친사본.patch — 시험해 본 고치는 방향 (아직 main 에 안 넣음)

QA 사본에 넣어 위 시험으로 효과를 확인하고, `npm test` 19개가 모두 통과한 변경분이다. 그대로 넣지 말고 출발점으로 쓴다.

| 파일 | 무엇 | 확인한 효과 |
|---|---|---|
| `session.js` | 요청 제한 시간 15초 · 재시도는 GET 만 | 멈추던 검사가 121초에 끝남 |
| `contract.js` | 인증 매트릭스 "진짜 토큰" 에서 로그아웃 경로 제외 | owner 로그아웃 없음 · 뒷정리 성공 |
| `runner.js` | 문자·메일·결제 호출이 있는 경로 제외 · 만든 것 기록 후 지움 · 뜬 서버만 재기 | 문자 50→0 · 남은 행 141→61 · Spring 100→79.2(실제로 잼) |
| `runner.js` (로그인 왜곡) | 423·"잠김" 도 잠김으로 · Q·D 는 로그인과 무관하게 · API 로그인 실패 시 화면 로그인 안 함 · 두 번 다 잰 영역끼리만 비교 | 틀린 비밀번호 실패 2→1회 · 잠김을 "계정이 잠겨 있다" 로 안내 · 못 잰 영역을 '고친 것' 으로 안 셈 |
| `stacks/django.js`·`fastapi.js` | 레포의 `.venv`·`venv` 파이썬 사용 | 맥에서 Django 완주 |

`git apply --check -p1 docs/2026-09-27_재현도구/고친사본.patch` 로 적용 가능한지 먼저 본다.
알려진 허점: 문자 경로 거르기가 경로 사이에 정의된 함수까지 읽어 `DELETE /api/items/:id` 를 잘못 거른다 (보고서 참고).
