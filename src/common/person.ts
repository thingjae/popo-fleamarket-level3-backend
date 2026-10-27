// L2에는 로그인이 없어서 "이름 + 연락처"로 사람을 구분한다.
// 앞뒤 공백이나 - 유무 차이로 다른 사람처럼 보이지 않게 정리해서 저장하고 비교한다.

/** 정리한 뒤의 연락처 모양: 010-1234-5678 */
export const PHONE_RE = /^010-\d{4}-\d{4}$/;
export const PHONE_MESSAGE = '연락처는 010으로 시작하는 휴대폰 번호 11자리로 입력해 주세요. (- 는 넣지 않아도 돼요)';

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** 01012345678, 010-1234-5678, 010 1234 5678 → 010-1234-5678 (형식이 아니면 그대로 둔다) */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return /^010\d{8}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : phone.trim();
}
