# Django (템플릿) QA

대상: [django-community-crud](https://github.com/ursamajor0714/django-community-crud) — `qa.config.js` 의 `root` 가 로컬 위치를 가리킨다.

```
node django-template/run.js            전체
node django-template/run.js --only=a,b 일부만
```

아직 **틀만 있다.** 영역 파일마다 `todo: true` 가 붙어 있고, 러너는 이것을 빈 칸으로 세서 점수에서 뺀다.
채우는 순서: `stack.js` (경로 찾기·로그인) → 영역 파일 → `todo` 줄 삭제.
구현 예시는 `../express-ejs/` 에 전부 있다.

## 이 스택에서 무엇으로 보나

| 칸 | 영역 | 방법 |
|---|---|---|
| 순수 프론트 | G | 템플릿의 {% url %}·{% block %}·form 필드가 실제로 있는가 |
| API 받아오는 프론트 | A | 템플릿의 {% url '이름' %} ↔ urls.py 의 name 대조 — 서버 렌더링이라 fetch 대신 이것 |
| API 기능 | D | models.py 제약(unique·null) ↔ 실제 저장 결과 |
| API 기능 | F | forms.py 검증이 빈 값·긴 값을 거절하는가 |
| 보안 | B | @login_required 없는 수정·삭제 view 가 있는가 |
| 보안 | C | 남의 글을 수정·삭제할 수 있는가 (작성자 비교) |
| 보안 | H | `python manage.py check --deploy` — Django 가 보안 설정 점검을 기본으로 준다 |
| 보안 | K | settings.py 의 SECRET_KEY·DEBUG=True · 레포에 올라간 db.sqlite3 |
| 보안 | V | `pip-audit -r requirements.txt` |

표에 없는 영역은 `../express-ejs/` 의 같은 파일과 같은 생각으로 만든다.
