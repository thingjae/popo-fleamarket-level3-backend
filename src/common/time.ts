// 모든 날짜 계산은 한국 시간(UTC+9) 기준이다.
// Render 서버는 UTC로 돌기 때문에, 서버 시계를 그대로 쓰면 "오늘"이 9시간 어긋난다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 신청 마감과 취소 기한: 행사일 며칠 전 23:59까지 */
export const DEADLINE_DAYS_BEFORE = 3;
/** 승인 후 입금 기한 */
export const PAYMENT_DUE_MS = 3 * DAY_MS;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 한국 시간 기준 날짜 문자열 (YYYY-MM-DD) */
export function kstDateOf(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function todayKst(now = new Date()): string {
  return kstDateOf(now);
}

export function addDays(dateStr: string, n: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 한국 시간으로 그 날짜의 hh:mm */
export function atKst(dateStr: string, time = '00:00'): Date {
  return new Date(`${dateStr}T${time}:00+09:00`);
}

/** YYYY-MM-DD 형식이고 실제로 있는 날짜인지 */
export function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** 행사일 3일 전 23:59:59 (한국 시간). 이 시각까지 신청·취소할 수 있다 */
export function applyDeadline(eventDate: string): Date {
  return new Date(atKst(addDays(eventDate, -DEADLINE_DAYS_BEFORE + 1)).getTime() - 1000);
}
