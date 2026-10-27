import type { ApplicationStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { addDays, applyDeadline, PAYMENT_DUE_MS, todayKst } from './time.js';

/** 자리를 차지하는 신청: 심사 대기 + 승인 (거절·취소는 자리를 돌려준다) */
export const ACTIVE_STATUSES: ApplicationStatus[] = ['PENDING', 'APPROVED'];

export type MarketState = 'OPEN' | 'CLOSED' | 'ENDED';
export const MARKET_STATE_LABEL: Record<MarketState, string> = {
  OPEN: '신청 중',
  CLOSED: '신청 마감',
  ENDED: '종료',
};

/** 마켓 상태는 저장하지 않고 날짜로 계산한다 */
export function marketState(eventDate: string, now = new Date()): MarketState {
  if (todayKst(now) > eventDate) return 'ENDED';
  if (now > applyDeadline(eventDate)) return 'CLOSED';
  return 'OPEN';
}

/** 이번 주말(토·일) 날짜 범위. 일요일이면 어제(토)~오늘 */
export function thisWeekend(now = new Date()): [string, string] {
  const today = todayKst(now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일
  const sat = dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
  return [sat, addDays(sat, 1)];
}

/**
 * R5 입금 기한: 승인 후 3일 안에 입금 확인이 안 된 신청을 자동 취소한다.
 * 무료 서버는 잠들기 때문에 타이머 대신, 신청 정보를 읽거나 바꾸기 직전에 매번 호출한다.
 */
export async function expireUnpaid(prisma: PrismaService, now = new Date()) {
  const { count } = await prisma.application.updateMany({
    where: {
      status: 'APPROVED',
      paymentStatus: 'UNPAID',
      approvedAt: { lt: new Date(now.getTime() - PAYMENT_DUE_MS) },
    },
    data: { status: 'CANCELED', cancelReason: 'PAYMENT_DUE', canceledAt: now },
  });
  return count;
}

export function paymentDueAt(approvedAt: Date | null) {
  return approvedAt ? new Date(approvedAt.getTime() + PAYMENT_DUE_MS) : null;
}

/** 가상계좌 안내 (실제로 존재하지 않는 번호) */
export const VIRTUAL_ACCOUNT = {
  bank: '포포은행(가상)',
  number: '000-0000-0000-00',
  holder: '포포플리마켓',
};
