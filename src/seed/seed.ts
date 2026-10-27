import bcrypt from 'bcryptjs';
import type { PrismaService } from '../prisma/prisma.service.js';
import type {
  ApplicationStatus,
  CancelReason,
  PaymentStatus,
} from '../generated/prisma/enums.js';
import { addDays, todayKst } from '../common/time.js';

// 가상 데이터. 실제 인물, 가게, 계좌, 연락처가 아니다.
// 날짜는 "다시 채우는 날"을 기준으로 만들어서, 언제 열어도 신청 중·마감·종료 마켓과 각 상태의 신청이 보인다.

export const DEMO_PASSWORD = 'popo1234!';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const SELLERS = [
  { name: '망원빈티지', keywords: ['빈티지', '리바이스', '밀리터리', '90년대'], memo: '직접 수선한 데님이 많아요', intro: '망원빈티지는 90년대 빈티지를 모으는 셀러예요. 이번 마켓에는 리바이스 데님 팬츠와 밀리터리 야상을 중심으로, 직접 수선한 데님도 함께 가져와요.', color: '#2f5d8a' },
  { name: '연남필름', keywords: ['빈티지', '필름카메라', '중고렌즈', '소품'], memo: '', intro: '연남필름은 빈티지 필름카메라와 중고렌즈를 소개해요. 작동을 확인한 카메라와 함께 작은 소품도 준비했어요.', color: '#8a5a2f' },
  { name: '합정레코드', keywords: ['LP', '레코드', '시티팝', '카세트'], memo: '턴테이블로 들어볼 수 있어요', intro: '합정레코드는 시티팝 LP와 카세트를 모아 온 레코드 셀러예요. 현장에서 턴테이블로 레코드를 들어볼 수 있어요.', color: '#3a3a3a' },
  { name: '상수니트', keywords: ['핸드메이드', '뜨개', '니트소품'], memo: '', intro: '상수니트는 직접 뜬 핸드메이드 뜨개 작품을 판매해요. 목도리와 파우치 같은 니트소품을 중심으로 가져와요.', color: '#b5637a' },
  { name: '공덕키즈', keywords: ['아동복', '장난감', '그림책'], memo: '깨끗하게 세탁했어요', intro: '공덕키즈는 아이가 자라며 작아진 아동복과 장난감, 그림책을 나눠요. 모든 옷은 깨끗하게 세탁해서 가져와요.', color: '#e0a526' },
  { name: '서교문구', keywords: ['빈티지', '문구', '엽서', '스티커'], memo: '', intro: '서교문구는 빈티지 문구를 좋아하는 셀러예요. 오래된 엽서와 스티커를 한자리에 모아 소개해요.', color: '#4f8a5b' },
  { name: '망원그릇', keywords: ['빈티지', '그릇', '일본그릇', '찻잔'], memo: '', intro: '망원그릇은 빈티지 그릇을 모으는 셀러예요. 이번에는 일본그릇과 찻잔을 중심으로 가져와요.', color: '#5b6fb5' },
  { name: '성산스니커', keywords: ['스니커즈', '나이키', '중고신발', '90년대'], memo: '사이즈별로 정리해 와요', intro: '성산스니커는 90년대 나이키 스니커즈를 중심으로 중고신발을 판매해요. 사이즈별로 정리해 와서 찾기 쉬워요.', color: '#c4452c' },
  { name: '연남플랜트', keywords: ['식물', '화분', '가드닝'], memo: '', intro: '연남플랜트는 집에서 키운 식물과 화분을 나눠요. 가드닝을 막 시작한 분께 맞는 작은 화분이 많아요.', color: '#3f7a3f' },
  { name: '합정북스', keywords: ['중고책', '독립출판', '만화책'], memo: '', intro: '합정북스는 중고책과 독립출판물을 소개해요. 오래 모아 온 만화책도 함께 가져와요.', color: '#7a4f8a' },
];

const EQUIPMENT = [
  { name: '천막 (3×3m)', unitPrice: 20000, totalQuantity: 10, description: '그늘막 겸 비 가림. 설치 도움 가능' },
  { name: '접이식 테이블', unitPrice: 5000, totalQuantity: 30, description: '180×60cm' },
  { name: '옷걸이 행거', unitPrice: 5000, totalQuantity: 15, description: '바퀴 달린 이동식 행거' },
  { name: '접이식 의자', unitPrice: 2000, totalQuantity: 40, description: '' },
  { name: '전신 거울', unitPrice: 3000, totalQuantity: 6, description: '의류 셀러 추천' },
];

// day: 오늘 기준 며칠 뒤 행사 (음수는 지난 마켓)
const MARKETS = [
  { title: '포포 연남 빈티지 마켓', neighborhood: '연남동', place: '연남 포포마당', address: '서울 마포구 포포길 21 (가상)', day: -6, totalBooths: 20, baseFee: 30000, autoApprove: false, description: '빈티지 의류와 소품 위주의 마켓이었어요.' },
  { title: '포포 망원 주말 플리마켓', neighborhood: '망원동', place: '망원 포포광장', address: '서울 마포구 포포로 12 (가상)', day: 4, totalBooths: 30, baseFee: 30000, autoApprove: false, description: '망원 한강 가는 길, 빈티지와 핸드메이드가 함께하는 주말 마켓이에요.' },
  { title: '포포 합정 레코드&북 마켓', neighborhood: '합정동', place: '합정 포포홀 앞마당', address: '서울 마포구 포포대로 45 (가상)', day: 2, totalBooths: 15, baseFee: 25000, autoApprove: false, description: '레코드, 책, 문구를 좋아하는 셀러들이 모여요. 신청은 마감됐어요.' },
  { title: '포포 상수 선데이 마켓', neighborhood: '상수동', place: '상수 포포공원', address: '서울 마포구 포포강변길 8 (가상)', day: 10, totalBooths: 12, baseFee: 35000, autoApprove: true, description: '신청하면 바로 승인되는 마켓이에요. 자리가 얼마 남지 않았어요.' },
  { title: '포포 공덕 패밀리 마켓', neighborhood: '공덕동', place: '공덕 포포플라자', address: '서울 마포구 포포로 300 (가상)', day: 17, totalBooths: 25, baseFee: 20000, autoApprove: false, description: '아동복, 장난감, 생활용품을 나누는 가족 마켓이에요.' },
];

type AppSeed = {
  market: number; // MARKETS 순서 (1부터)
  seller: number; // SELLERS 순서 (1부터)
  booths: number;
  status: ApplicationStatus;
  pay?: PaymentStatus;
  approvedDaysAgo?: number;
  cancel?: CancelReason;
  reject?: string;
  eq?: [equipment: number, quantity: number][];
  photos?: number;
};

const APPS: AppSeed[] = [
  // 1. 지난 마켓 (종료)
  { market: 1, seller: 1, booths: 2, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 14, eq: [[3, 2], [5, 1]], photos: 3 },
  { market: 1, seller: 2, booths: 1, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 13, eq: [[2, 1]], photos: 2 },
  { market: 1, seller: 3, booths: 1, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 12, eq: [[2, 1], [4, 2]], photos: 2 },
  { market: 1, seller: 6, booths: 1, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 12, photos: 1 },
  { market: 1, seller: 7, booths: 1, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 11, eq: [[2, 1]], photos: 2 },
  // 2. 이번 주 신청 중 (심사제)
  { market: 2, seller: 1, booths: 2, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 4, eq: [[1, 1], [3, 2], [5, 1]], photos: 3 },
  { market: 2, seller: 2, booths: 1, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 3, eq: [[2, 1]], photos: 2 },
  { market: 2, seller: 3, booths: 1, status: 'APPROVED', pay: 'UNPAID', approvedDaysAgo: 1, eq: [[2, 1], [4, 1]], photos: 2 },
  { market: 2, seller: 4, booths: 1, status: 'PENDING', eq: [[2, 1]], photos: 2 },
  { market: 2, seller: 5, booths: 2, status: 'PENDING', eq: [[2, 2], [4, 2]], photos: 1 },
  { market: 2, seller: 6, booths: 1, status: 'REJECTED', reject: '이번 마켓은 의류·핸드메이드 위주라 다음 문구 마켓에서 뵐게요.' },
  { market: 2, seller: 8, booths: 1, status: 'CANCELED', pay: 'UNPAID', approvedDaysAgo: 5, cancel: 'PAYMENT_DUE' },
  { market: 2, seller: 9, booths: 1, status: 'CANCELED', pay: 'REFUND_PENDING', approvedDaysAgo: 6, cancel: 'SELLER' },
  { market: 2, seller: 7, booths: 1, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 2, eq: [[2, 1]], photos: 2 },
  // 3. 신청 마감 (행사 2일 전)
  { market: 3, seller: 3, booths: 2, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 7, eq: [[2, 2]], photos: 2 },
  { market: 3, seller: 6, booths: 1, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 6, eq: [[2, 1]], photos: 1 },
  { market: 3, seller: 10, booths: 1, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 5, eq: [[2, 1], [4, 1]], photos: 2 },
  { market: 3, seller: 2, booths: 1, status: 'APPROVED', pay: 'UNPAID', approvedDaysAgo: 1, photos: 1 },
  // 4. 자동 승인, 거의 다 참 (12부스 중 11)
  { market: 4, seller: 1, booths: 3, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 2, eq: [[1, 1], [3, 3]], photos: 2 },
  { market: 4, seller: 5, booths: 2, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 2, eq: [[2, 2]], photos: 1 },
  { market: 4, seller: 7, booths: 2, status: 'APPROVED', pay: 'PAID', approvedDaysAgo: 1, eq: [[2, 1]], photos: 2 },
  { market: 4, seller: 8, booths: 2, status: 'APPROVED', pay: 'UNPAID', approvedDaysAgo: 0, eq: [[3, 1], [5, 1]], photos: 2 },
  { market: 4, seller: 10, booths: 2, status: 'APPROVED', pay: 'UNPAID', approvedDaysAgo: 1, eq: [[2, 1]], photos: 1 },
  // 5. 다음 달 (심사제)
  { market: 5, seller: 5, booths: 1, status: 'PENDING', eq: [[2, 1]], photos: 1 },
  { market: 5, seller: 9, booths: 1, status: 'APPROVED', pay: 'UNPAID', approvedDaysAgo: 0, eq: [[2, 1], [4, 2]], photos: 2 },
];

/** 셀러별 색으로 만든 가상 대표 사진 (SVG) */
function demoPhoto(name: string, keyword: string, color: string, n: number) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const shade = n % 2 === 0 ? 0.85 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
<rect width="600" height="600" fill="${color}" opacity="${shade}"/>
<circle cx="${150 + n * 90}" cy="${170 + n * 40}" r="${110 - n * 15}" fill="#ffffff" opacity="0.12"/>
<text x="50%" y="46%" text-anchor="middle" font-family="sans-serif" font-size="58" font-weight="700" fill="#ffffff">${esc(keyword)}</text>
<text x="50%" y="58%" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#ffffff" opacity="0.85">${esc(name)} · 사진 ${n + 1}</text>
<text x="50%" y="92%" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#ffffff" opacity="0.6">가상 데이터</text>
</svg>`;
}

/** 모든 데이터를 지우고 가상 데이터로 다시 채운다. 번호도 1번부터 다시 시작한다. */
export async function reseed(prisma: PrismaService, now = new Date()) {
  const today = todayKst(now);
  const s = `"${prisma.schema}"`;
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `TRUNCATE TABLE ${s}.application_photos, ${s}.application_equipment, ${s}.inquiries, ${s}.applications, ${s}.equipment, ${s}.markets, ${s}.users RESTART IDENTITY CASCADE`,
      );

      await tx.user.createMany({
        data: [
          { email: 'admin@popo.test', passwordHash: hash, role: 'ADMIN', name: '포포 운영진', phone: '010-0000-0000' },
          ...SELLERS.map((sl, i) => ({
            email: `seller${i + 1}@popo.test`,
            passwordHash: hash,
            role: 'SELLER' as const,
            name: sl.name,
            phone: `010-0000-${String(1001 + i)}`,
          })),
        ],
      });
      // 회원 번호: 1 = 관리자, 2~11 = 셀러 1~10

      await tx.equipment.createMany({ data: EQUIPMENT });

      await tx.market.createMany({
        data: MARKETS.map(({ day, ...m }) => ({
          ...m,
          eventDate: addDays(today, day),
          startTime: '12:00',
          endTime: '18:00',
          createdAt: new Date(now.getTime() - 20 * DAY),
        })),
      });

      for (const [i, a] of APPS.entries()) {
        const market = MARKETS[a.market - 1];
        const seller = SELLERS[a.seller - 1];
        const lines = a.eq ?? [];
        const totalFee =
          market.baseFee * a.booths + lines.reduce((sum, [e, q]) => sum + EQUIPMENT[e - 1].unitPrice * q, 0);
        const approvedAt =
          a.approvedDaysAgo !== undefined ? new Date(now.getTime() - a.approvedDaysAgo * DAY - 2 * HOUR) : null;
        const createdAt = new Date((approvedAt ?? now).getTime() - (approvedAt ? 1 : 0) * DAY - (i + 1) * HOUR);

        const created = await tx.application.create({
          data: {
            marketId: a.market,
            sellerId: a.seller + 1,
            boothCount: a.booths,
            keywords: seller.keywords,
            memo: seller.memo,
            intro: seller.intro,
            saleLinks: [`https://m.bunjang.co.kr/shop/popo-demo-${a.seller}`],
            status: a.status,
            paymentStatus: a.pay ?? 'UNPAID',
            totalFee,
            approvedAt,
            paidAt: a.pay === 'PAID' || a.pay === 'REFUND_PENDING' ? new Date((approvedAt ?? now).getTime() + 5 * HOUR) : null,
            canceledAt: a.status === 'CANCELED' ? new Date(now.getTime() - DAY) : null,
            cancelReason: a.cancel ?? null,
            rejectReason: a.reject ?? null,
            createdAt,
            equipment: {
              create: lines.map(([e, q]) => ({ equipmentId: e, quantity: q, unitPrice: EQUIPMENT[e - 1].unitPrice })),
            },
          },
        });

        const photoCount = a.photos ?? 0;
        if (photoCount > 0) {
          await tx.photo.createMany({
            data: Array.from({ length: photoCount }, (_, n) => ({
              uploaderId: a.seller + 1,
              applicationId: created.id,
              mimeType: 'image/svg+xml',
              data: new Uint8Array(Buffer.from(demoPhoto(seller.name, seller.keywords[n % seller.keywords.length], seller.color, n))),
              sortOrder: n,
            })),
          });
        }
      }

      await tx.inquiry.createMany({
        data: [
          { marketId: 3, sellerId: 2, content: '합정 마켓 신청이 마감됐는데, 혹시 취소 자리가 생기면 1부스 들어갈 수 있을까요?', createdAt: new Date(now.getTime() - 5 * HOUR) },
          { marketId: 3, sellerId: 9, content: '식물 셀러인데 레코드&북 마켓에도 참가할 수 있나요?', createdAt: new Date(now.getTime() - 20 * HOUR) },
          { marketId: 2, sellerId: 6, status: 'DONE', content: '거절 사유를 조금 더 자세히 알 수 있을까요?', createdAt: new Date(now.getTime() - 2 * DAY) },
        ],
      });
    },
    { timeout: 60_000 },
  );

  return {
    users: SELLERS.length + 1,
    markets: MARKETS.length,
    equipment: EQUIPMENT.length,
    applications: APPS.length,
    inquiries: 3,
  };
}
