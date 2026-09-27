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
