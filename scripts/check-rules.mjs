// 규칙 자동 점검: 화면을 거치지 않고 서버에 직접 요청을 보내서,
// 규칙 R1~R9, 역할 권한, 입력값 확인, 신청 → 승인 → 입금 → 취소 → 환불 흐름, AI 소개글을 확인한다.
//
// 사용법:  node scripts/check-rules.mjs                         (로컬 서버)
//          API_URL=https://...onrender.com node scripts/check-rules.mjs   (배포 서버)
//          SKIP_AI=1 node scripts/check-rules.mjs                (AI 호출 빼고)
//
// 주의: 시작과 끝에 가상 데이터를 다시 채운다.

const API = (process.env.API_URL ?? 'http://localhost:4100').replace(/\/+$/, '');
const PW = 'popo1234!';
const stamp = Date.now().toString(36);

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: PW } })).data.token;
async function signup(tag) {
  const r = await call('POST', '/auth/signup', {
    body: { email: `check-${tag}-${stamp}@popo.test`, password: PW, name: `점검셀러${tag}`, phone: '01099990000' },
  });
  return r.data.token;
}

const results = [];
async function check(name, expect, fn) {
  try {
    const r = await fn();
    const code = r.data?.code ?? '';
    const ok = r.status === expect.status && (!expect.code || code === expect.code);
    results.push({ name, ok, expected: `${expect.status}${expect.code ? ' ' + expect.code : ''}`, actual: `${r.status}${code ? ' ' + code : ''}`, message: r.data?.message ?? r.note ?? '' });
  } catch (e) {
    results.push({ name, ok: false, expected: `${expect.status} ${expect.code ?? ''}`, actual: 'ERROR', message: String(e) });
  }
}
const pass = (ok, note) => ({ status: ok ? 200 : 500, data: { message: note } });

// 준비: 가상 데이터를 처음 상태로
let admin = await login('admin@popo.test');
const reset = await call('POST', '/admin/seed/reset', { token: admin });
if (reset.status !== 200) { console.error('가상 데이터 다시 채우기 실패:', reset); process.exit(1); }
admin = await login('admin@popo.test');
const seller3 = await login('seller3@popo.test'); // 합정레코드
const seller4 = await login('seller4@popo.test'); // 상수니트: 망원 마켓 심사 대기
const sellerNew = await signup('a');
const sellerNew2 = await signup('b');

const markets = (await call('GET', '/markets')).data;
const M = Object.fromEntries(markets.map((m) => [m.title.split(' ')[1], m])); // 연남, 망원, 합정, 상수, 공덕
const baseApply = (marketId, extra = {}) => ({
  marketId, boothCount: 1, keywords: ['빈티지', '셔츠', '가방'], intro: '점검용 소개글이에요.', ...extra,
});

// ── 입력값 확인
await check('입력: 이메일 형식 틀림', { status: 400, code: 'VALIDATION' }, () =>
  call('POST', '/auth/signup', { body: { email: 'popo', password: PW, name: '가', phone: '01000000000' } }));
await check('입력: 비밀번호 8자 미만', { status: 400, code: 'VALIDATION' }, () =>
  call('POST', '/auth/signup', { body: { email: `x-${stamp}@popo.test`, password: '1234', name: '가', phone: '01000000000' } }));
await check('입력: 이미 가입된 이메일', { status: 400, code: 'VALIDATION' }, () =>
  call('POST', '/auth/signup', { body: { email: 'seller1@popo.test', password: PW, name: '가', phone: '01000000000' } }));
await check('입력: 연락처 - 없이 가입 → 010-xxxx-xxxx로 저장', { status: 200 }, async () => {
  const me = await call('GET', '/auth/me', { token: sellerNew });
  return pass(me.data.phone === '010-9999-0000', `저장된 연락처: ${me.data.phone}`);
});
await check('입력: 키워드 3개 미만', { status: 400, code: 'VALIDATION' }, () =>
  call('POST', '/applications', { token: sellerNew, body: baseApply(M['망원'].id, { keywords: ['빈티지'] }) }));
await check('입력: 부스 수에 글자', { status: 400, code: 'VALIDATION' }, () =>
  call('POST', '/applications', { token: sellerNew, body: baseApply(M['망원'].id, { boothCount: '두개' }) }));
await check('입력: 판매 링크 형식 틀림', { status: 400, code: 'VALIDATION' }, () =>
  call('POST', '/applications', { token: sellerNew, body: baseApply(M['망원'].id, { saleLinks: ['bunjang'] }) }));
await check('입력: 사진 11장', { status: 400, code: 'VALIDATION' }, () =>
  call('POST', '/applications', { token: sellerNew, body: baseApply(M['망원'].id, { photoIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }) }));
await check('입력: 마켓 행사일이 지난 날짜 (관리자)', { status: 400, code: 'VALIDATION' }, () =>
  call('POST', '/markets', { token: admin, body: { title: '점검', neighborhood: '망원동', place: '가', address: '가', eventDate: '2020-01-01', startTime: '12:00', endTime: '18:00', totalBooths: 1, baseFee: 0 } }));
await check('입력: 로그인 비밀번호 틀림', { status: 401, code: 'LOGIN' }, () =>
  call('POST', '/auth/login', { body: { email: 'seller1@popo.test', password: 'wrong-password' } }));

// ── R9 로그인 필요, R6 역할 권한
await check('R9 로그인 없이 부스 신청', { status: 401, code: 'R9' }, () =>
  call('POST', '/applications', { body: baseApply(M['망원'].id) }));
await check('R9 위조한 출입증', { status: 401, code: 'R9' }, () =>
  call('GET', '/applications/mine', { token: 'abc.def.ghi' }));
await check('R6 셀러가 현황 보기', { status: 403, code: 'R6' }, () => call('GET', '/admin/stats', { token: seller4 }));
await check('R6 셀러가 마켓 등록', { status: 403, code: 'R6' }, () =>
  call('POST', '/markets', { token: seller4, body: { title: '몰래', neighborhood: '망원동', place: '가', address: '가', eventDate: '2099-01-01', startTime: '12:00', endTime: '18:00', totalBooths: 1, baseFee: 0 } }));
await check('R6 셀러가 신청 승인', { status: 403, code: 'R6' }, () => call('POST', '/admin/applications/1/approve', { token: seller4 }));
await check('R6 셀러가 장비 삭제', { status: 403, code: 'R6' }, () => call('DELETE', '/equipment/1', { token: seller4 }));
await check('R6 셀러가 다른 셀러의 신청 보기', { status: 403, code: 'R6' }, () => call('GET', '/applications/1', { token: seller4 }));
await check('R6 관리자가 셀러 기능(부스 신청)', { status: 403, code: 'R6' }, () =>
  call('POST', '/applications', { token: admin, body: baseApply(M['망원'].id) }));

// ── 신청 규칙
await check('R1 남은 부스보다 많이 (상수 마켓 1개 남음, 2개 신청)', { status: 409, code: 'R1' }, () =>
  call('POST', '/applications', { token: sellerNew, body: baseApply(M['상수'].id, { boothCount: 2 }) }));
await check('R2 마감된 마켓에 신청 (합정)', { status: 409, code: 'R2' }, () =>
  call('POST', '/applications', { token: sellerNew, body: baseApply(M['합정'].id) }));
await check('R3 장비 재고 초과 (망원 천막 9개 남음, 10개)', { status: 409, code: 'R3' }, () =>
  call('POST', '/applications', { token: sellerNew, body: baseApply(M['망원'].id, { equipment: [{ equipmentId: 1, quantity: 10 }] }) }));
await check('R7 같은 마켓에 두 번 신청 (상수니트, 망원)', { status: 409, code: 'R7' }, () =>
  call('POST', '/applications', { token: seller4, body: baseApply(M['망원'].id) }));
const s3apps = (await call('GET', '/applications/mine', { token: seller3 })).data;
const s3Closed = s3apps.find((a) => a.market.id === M['합정'].id);
await check('R4 행사 3일 전 지나 취소 (합정레코드, 합정)', { status: 409, code: 'R4' }, () =>
  call('POST', `/applications/${s3Closed.id}/cancel`, { token: seller3 }));
const all = (await call('GET', '/admin/applications', { token: admin })).data;
const expired = all.find((a) => a.cancelReason === 'PAYMENT_DUE');
await check('R5 입금 기한 지나 자동 취소된 신청에 입금 확인', { status: 409, code: 'R5' }, () =>
  call('POST', `/admin/applications/${expired.id}/confirm-payment`, { token: admin }));
await check('R8 신청에 쓰이는 장비 삭제 (접이식 테이블)', { status: 409, code: 'R8' }, () =>
  call('DELETE', '/equipment/2', { token: admin }));

// ── 정상 흐름: 사진 → 신청(심사) → 승인 → 입금 확인 → 셀러 취소 → 환불 완료
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let photoId;
await check('정상: 사진 올리기', { status: 201 }, async () => {
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'item.png');
  const r = await call('POST', '/photos', { token: sellerNew, form: fd });
  photoId = r.data?.id;
  return r;
});
await check('입력: 사진이 아닌 파일', { status: 400, code: 'VALIDATION' }, async () => {
  const fd = new FormData();
  fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  return call('POST', '/photos', { token: sellerNew, form: fd });
});
let app;
await check('정상: 부스 신청 (부스 2, 테이블 2, 옷걸이 1 → 금액 서버 계산)', { status: 201 }, async () => {
  const r = await call('POST', '/applications', {
    token: sellerNew,
    body: baseApply(M['망원'].id, { boothCount: 2, equipment: [{ equipmentId: 2, quantity: 2 }, { equipmentId: 3, quantity: 1 }], photoIds: [photoId], saleLinks: ['https://m.bunjang.co.kr/shop/check'] }),
  });
  app = r.data;
  const expected = M['망원'].baseFee * 2 + 5000 * 2 + 5000;
  if (r.status === 201 && (app.totalFee !== expected || app.status !== 'PENDING')) return pass(false, `금액 ${app.totalFee} (기대 ${expected}), 상태 ${app.status}`);
  return r;
});
await check('정상: 관리자 승인', { status: 200 }, () => call('POST', `/admin/applications/${app.id}/approve`, { token: admin }));
await check('정상: 승인 뒤 셀러에게 가상계좌·입금 기한 표시', { status: 200 }, async () => {
  const mine = (await call('GET', '/applications/mine', { token: sellerNew })).data.find((a) => a.id === app.id);
  return pass(Boolean(mine.account?.number && mine.paymentDueAt), `${mine.statusLabel} · ${mine.account?.bank} ${mine.account?.number}`);
});
await check('정상: 관리자 입금 확인', { status: 200 }, () => call('POST', `/admin/applications/${app.id}/confirm-payment`, { token: admin }));
await check('R6 다른 셀러가 남의 신청 취소', { status: 403, code: 'R6' }, () => call('POST', `/applications/${app.id}/cancel`, { token: sellerNew2 }));
await check('정상: 셀러 취소 → 환불 예정', { status: 200 }, async () => {
  const r = await call('POST', `/applications/${app.id}/cancel`, { token: sellerNew });
  return r.data?.paymentStatus === 'REFUND_PENDING' ? r : pass(false, `결제 상태 ${r.data?.paymentStatus}`);
});
await check('정상: 관리자 환불 완료', { status: 200 }, () => call('POST', `/admin/applications/${app.id}/refund`, { token: admin }));

// 자동 승인 마켓 (상수): 마지막 1부스 → 바로 승인
await check('정상: 자동 승인 마켓은 신청 즉시 승인', { status: 201 }, async () => {
  const r = await call('POST', '/applications', { token: sellerNew2, body: baseApply(M['상수'].id) });
  return r.data?.status === 'APPROVED' ? r : pass(false, `상태 ${r.data?.status}`);
});
await check('R1 부스가 모두 찬 마켓 (상수)', { status: 409, code: 'R1' }, () =>
  call('POST', '/applications', { token: sellerNew, body: baseApply(M['상수'].id) }));

// 동시에 마지막 자리를 신청하면 하나만 성공 (R1)
await check('동시 신청 2건 → 1건만 성공 (부스 1개짜리 새 마켓)', { status: 200 }, async () => {
  const future = new Date(Date.now() + 9 * 3600e3 + 20 * 86400e3).toISOString().slice(0, 10);
  const m = await call('POST', '/markets', { token: admin, body: { title: '점검 마켓', neighborhood: '망원동', place: '점검 장소', address: '가상', eventDate: future, startTime: '12:00', endTime: '18:00', totalBooths: 1, baseFee: 10000 } });
  const [a, b] = await Promise.all([
    call('POST', '/applications', { token: sellerNew, body: baseApply(m.data.id) }),
    call('POST', '/applications', { token: sellerNew2, body: baseApply(m.data.id) }),
  ]);
  const st = [a.status, b.status].sort();
  return pass(st[0] === 201 && st[1] === 409, `결과: ${a.status}, ${b.status}`);
});

// 장비 관리 (관리자)
await check('정상: 장비 등록 → 수정 → 삭제 (아무도 안 빌린 장비)', { status: 200 }, async () => {
  const c = await call('POST', '/equipment', { token: admin, body: { name: '점검 조명', unitPrice: 3000, totalQuantity: 4 } });
  const u = await call('PATCH', `/equipment/${c.data.id}`, { token: admin, body: { unitPrice: 4000 } });
  const d = await call('DELETE', `/equipment/${c.data.id}`, { token: admin });
  return pass(c.status === 201 && u.data?.unitPrice === 4000 && d.status === 200, `등록 ${c.status}, 수정 ${u.data?.unitPrice}원, 삭제 ${d.status}`);
});

// 문의
await check('정상: 마감된 마켓에 문의 남기기', { status: 201 }, () =>
  call('POST', '/inquiries', { token: sellerNew, body: { marketId: M['합정'].id, content: '마감됐는데 1부스 가능할까요?' } }));
await check('R6 셀러가 문의함 보기', { status: 403, code: 'R6' }, () => call('GET', '/admin/inquiries', { token: sellerNew }));

// 구매자 (로그인 없음)
await check('정상: 로그인 없이 마켓 상세 + 셀러 미리보기', { status: 200 }, async () => {
  const r = await call('GET', `/markets/${M['망원'].id}`);
  const leaked = JSON.stringify(r.data).match(/popo\.test|010-0000/);
  return pass(r.status === 200 && r.data.sellers.length > 0 && !leaked, `셀러 ${r.data.sellers.length}명, 키워드 ${r.data.keywords.length}개, 이메일·연락처 노출 ${leaked ? '있음!' : '없음'}`);
});
await check('정상: 검색 (망원) + 이번 주말 필터', { status: 200 }, async () => {
  const a = await call('GET', `/markets?keyword=${encodeURIComponent('망원')}`);
  const b = await call('GET', '/markets?state=OPEN');
  return pass(a.data.length >= 1 && b.data.every((m) => m.state === 'OPEN'), `검색 ${a.data.length}개, 신청 중 ${b.data.length}개`);
});

// AI
if (!process.env.SKIP_AI) {
  await check('AI: 키워드로 소개글 만들기 (GPT)', { status: 200 }, async () => {
    const r = await call('POST', '/ai/seller-intro', { token: sellerNew, body: { keywords: ['빈티지', '리바이스', '밀리터리'], memo: '직접 수선한 데님이 많아요' } });
    return r.status === 200 ? { status: 200, data: { message: `${r.data.intro} (빠진 키워드: ${r.data.missingKeywords.join(', ') || '없음'})` } } : r;
  });
}
await check('AI: 키워드 2개면 거절', { status: 400, code: 'VALIDATION' }, () =>
  call('POST', '/ai/seller-intro', { token: sellerNew, body: { keywords: ['빈티지', '셔츠'] } }));
await check('R6 관리자는 AI 소개글(셀러 기능) 불가', { status: 403, code: 'R6' }, () =>
  call('POST', '/ai/seller-intro', { token: admin, body: { keywords: ['a', 'b', 'c'] } }));

await check('/health', { status: 200 }, () => call('GET', '/health'));
await check('가상 데이터 다시 채우기', { status: 200 }, () => call('POST', '/admin/seed/reset', { token: admin }));

const ok = results.filter((r) => r.ok).length;
console.log(`\n규칙 자동 점검 (${API}) — ${ok}/${results.length} 통과\n`);
console.log('| 결과 | 점검 | 기대 | 실제 | 서버가 보낸 안내 |');
console.log('| --- | --- | --- | --- | --- |');
for (const r of results) console.log(`| ${r.ok ? '✅' : '❌'} | ${r.name} | ${r.expected} | ${r.actual} | ${String(r.message).replace(/\n/g, ' ')} |`);
process.exit(ok === results.length ? 0 : 1);
