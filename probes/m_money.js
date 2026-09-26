// M. 금액 계산 — 돈이 맞는가. 여기가 틀리면 사장님이 세무서에 잘못된 숫자를 낸다.
// API 응답을 믿지 않고 DB 원본에서 따로 계산해 대조한다.
const { check } = require('../lib/core');

module.exports = {
  id: 'M', name: '금액 계산', weight: 8,
  async run(ctx) {
    const checks = [];
    const month = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);

    // ── 1. 가계부 수입·지출·순익이 서로 맞는가
    const led = (await ctx.call(`/api/ledger?month=${month}`)).body || {};
    const income = (led.income || []).reduce((s, r) => s + (r.amount || 0), 0);
    const expense = (led.expense || []).reduce((s, r) => s + (r.amount || 0), 0);
    const inner = [
      ['수입 합계 = 수입 항목의 합', led.income_total === income, `${led.income_total} vs ${income}`],
      ['지출 합계 = 지출 항목의 합', led.expense_total === expense, `${led.expense_total} vs ${expense}`],
      ['순익 = 수입 − 지출',        led.net === (led.income_total - led.expense_total), `${led.net}`],
    ];
    checks.push(check('가계부 안에서 합계가 맞는다', {
      universe: inner.length, scanned: inner.length, passed: inner.filter(x => x[1]).length,
      notes: inner.filter(x => !x[1]).map(x => `${x[0]} 어긋남: ${x[2]}`),
    }));

    // ── 2. 매출 내역과 가계부가 같은 숫자를 내는가 (같은 돈을 두 화면이 다르게 말하면 안 된다)
    const rev = (await ctx.call('/api/revenue/all')).body || {};
    const items = rev.items || rev.rows || (Array.isArray(rev) ? rev : []);
    const revThisMonth = items.filter(x => String(x.paid_at || '').slice(0, 7) === month)
                              .filter(x => (x.amount || 0) > 0)
                              .reduce((s, x) => s + x.amount, 0);
    const sameNumber = revThisMonth === led.income_total;
    checks.push(check('매출 내역과 가계부 수입이 같다', {
      universe: 1, scanned: 1, passed: sameNumber ? 1 : 0,
      notes: sameNumber ? [`두 화면 모두 ${revThisMonth.toLocaleString('ko-KR')}원`]
                        : [`매출 내역 ${revThisMonth} vs 가계부 수입 ${led.income_total}`],
    }));

    // ── 3. DB 원본에서 직접 더한 값과 맞는가 (API 를 믿지 않는다)
    const notes3 = [];
    let ok3 = 0, total3 = 0;
    const sqlPairs = [
      ['회원 등록 매출', `select coalesce(sum(amount),0) from member_registrations where to_char(created_at::timestamp,'YYYY-MM')='${month}'`],
      ['락커 매출',      `select coalesce(sum(amount),0) from locker_history where action='배정' and to_char(created_at::timestamp,'YYYY-MM')='${month}'`],
      ['가계부 직접 수입', `select coalesce(sum(amount),0) from ledger_entries where kind='매출' and to_char(entry_date::date,'YYYY-MM')='${month}'`],
    ];
    const sums = {};
    for (const [label, q] of sqlPairs) {
      total3++;
      const v = ctx.sql(q);
      if (v === null) { notes3.push(`${label}: DB 조회 불가 (도커가 꺼져 있나)`); continue; }
      sums[label] = Number(v);
      ok3++;
    }
    if (ok3 === total3) {
      const dbTotal = Object.values(sums).reduce((a, b) => a + b, 0);
      // 고정비로 펼쳐지는 수입이 있으면 DB 단순합과 다를 수 있으므로 차이를 적어 둔다
      const diff = led.income_total - dbTotal;
      checks.push(check('DB 원본 합계와 화면 수입이 맞는다', {
        universe: 1, scanned: 1, passed: diff === 0 ? 1 : 0,
        notes: diff === 0 ? [`DB 합계 ${dbTotal.toLocaleString('ko-KR')}원 = 화면 ${led.income_total.toLocaleString('ko-KR')}원`]
          : [`DB 합계 ${dbTotal} / 화면 ${led.income_total} — 차이 ${diff} (고정비 펼침이나 누락)`],
      }));
    } else {
      checks.push(check('DB 원본 합계와 화면 수입이 맞는다', { universe: 1, scanned: 0, passed: 0, notes: notes3 }));
    }

    // ── 4. 홈에는 금액이 아예 없어야 한다 (코치와 함께 보는 화면)
    const stats = (await ctx.call('/api/stats')).body || {};
    const moneyKeys = Object.keys(stats).filter(k => /amount|revenue|total|price|매출/.test(k));
    const homeMarkup = ctx.read('frontend/views/admin.ejs');
    // '<!-- 매출 관리' 주석 자체가 딸려 들어오면 '매출' 이라는 글자에 걸린다. 그 앞까지만 자른다.
    const homeStart = homeMarkup.indexOf('<!-- 홈 -->');
    const homeEnd = homeMarkup.indexOf('<!-- 매출 관리', homeStart);
    const homeSection = homeMarkup.slice(homeStart, homeEnd > 0 ? homeEnd : undefined);
    // '회원</div>' 의 '원<' 같은 우연한 일치를 피해, 금액을 뜻하는 표현만 본다
    // '회원</div>' 의 '원<' 에 걸리지 않도록, 숫자가 앞에 붙은 '원' 만 금액으로 본다
    const moneyInHome = /매출|금액|monthly-amount|[0-9][0-9,]*\s*원/.test(homeSection);
    checks.push(check('홈 화면과 홈 응답에 금액이 없다', {
      universe: 2, scanned: 2, passed: (moneyKeys.length === 0 ? 1 : 0) + (moneyInHome ? 0 : 1),
      notes: [...moneyKeys.map(k => `홈 응답에 금액 키 ${k} 가 있다`),
              ...(moneyInHome ? ['홈 화면 마크업에 금액 문구가 있다'] : [])],
    }));

    // ── 5. 0원 자동 매출이 목록을 더럽히지 않는가
    const zeroRows = items.filter(x => (x.amount || 0) === 0);
    checks.push(check('0원짜리 빈 줄이 매출 목록에 없다', {
      universe: items.length || 1, scanned: items.length || 1, passed: (items.length || 1) - zeroRows.length,
      notes: zeroRows.length ? [`0원 행 ${zeroRows.length}건이 목록에 있다`] : [],
    }));

    // ── 6. 고정비 펼치기 자체 점검 (그 달에 없는 날짜를 만들지 않는가)
    let ledgerUnit = 0;
    try {
      require(ctx.config.root + '/backend/utils/ledger.js');
      const { expandLedgerRows } = require(ctx.config.root + '/backend/utils/ledger.js');
      const rows = expandLedgerRows([{ id: 1, kind: '지출', category: '임대료', amount: 100,
        entry_date: '2026-01-31', is_fixed: 1 }], '2026-02');   // 고정날짜: 말일·윤년 계산이라 날짜가 바뀌면 안 된다
      const bad = rows.filter(r => {
        const [y, m, d] = r.entry_date.split('-').map(Number);
        return new Date(y, m - 1, d).getDate() !== d;   // 달력에 없는 날짜
      });
      ledgerUnit = bad.length === 0 ? 1 : 0;
      checks.push(check('고정비를 펼칠 때 없는 날짜를 만들지 않는다', {
        universe: 1, scanned: 1, passed: ledgerUnit,
        notes: bad.length ? bad.map(b => `달력에 없는 ${b.entry_date} 가 만들어졌다`) : ['1월 31일 고정비 → 2월은 말일로 당겨짐'],
      }));
    } catch (e) {
      checks.push(check('고정비를 펼칠 때 없는 날짜를 만들지 않는다', {
        universe: 1, scanned: 0, passed: 0, notes: ['ledger 유틸을 불러오지 못했다: ' + e.message] }));
    }

    // ── 7. 값이 말이 되는가 (원본을 직접 훑는다)
    //
    // 합계가 맞아도 개별 값이 말이 안 될 수 있다. 사람이 손으로 고치다 생기는 것들이다.
    const sanity = [
      ['환불이 결제보다 큰 회원권',
       `select count(*) from (
          select member_id, sum(case when amount>0 then amount else 0 end) as paid,
                 sum(case when amount<0 then -amount else 0 end) as refunded
          from member_registrations group by member_id
        ) t where refunded > paid`],
      ['시작일이 만료일보다 뒤인 회원권',
       `select count(*) from member_registrations
         where start_date is not null and end_date is not null and start_date > end_date`],
      ['시작일이 만료일보다 뒤인 락커',
       `select count(*) from lockers
         where start_date is not null and end_date is not null and start_date > end_date`],
      ['금액이 음수인 락커 배정',
       `select count(*) from locker_history where action='배정' and amount < 0`],
      ['현재 회원권이 두 개 이상인 회원',
       `select count(*) from (
          select member_id from member_registrations where is_current=1
          group by member_id having count(*) > 1) t`],
      ['잔여 횟수가 총 횟수보다 많은 횟수권',
       `select count(*) from member_registrations
         where reg_type='횟수권' and remaining_count is not null and period is not null
           and remaining_count > period`],
      ['쓴 홀딩이 부여 홀딩보다 많은 회원권',
       `select count(*) from member_registrations
         where coalesce(holding_days,0) > coalesce(holding_total,0)`],
    ];
    let sane = 0, saneScanned = 0; const saneNotes = [];
    for (const [label, q] of sanity) {
      const n = ctx.sql(q);
      if (n === null) { saneNotes.push(`${label}: DB 조회 불가`); continue; }
      saneScanned++;
      if (Number(n) === 0) sane++;
      else saneNotes.push(`${label} — ${n}건`);
    }
    checks.push(check('저장된 값이 말이 된다', {
      universe: sanity.length, scanned: saneScanned, passed: sane, notes: saneNotes,
    }));

    // ── 8. 달별 순익이 수입 − 지출과 맞는가 (최근 6개월)
    const netNotes = [];
    let netOk = 0, netScanned = 0;
    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.now() + 9 * 3600000);
      d.setUTCMonth(d.getUTCMonth() - i);
      const m = d.toISOString().slice(0, 7);
      const led = (await ctx.call(`/api/ledger?month=${m}`)).body;
      if (!led) continue;
      netScanned++;
      if (led.net === (led.income_total || 0) - (led.expense_total || 0)) netOk++;
      else netNotes.push(`${m}: 순익 ${led.net} ≠ ${led.income_total} − ${led.expense_total}`);
    }
    checks.push(check('달마다 순익 = 수입 − 지출', {
      universe: 6, scanned: netScanned, passed: netOk, notes: netNotes,
    }));

    return { checks };
  },
};
