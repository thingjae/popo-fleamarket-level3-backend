import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

// 모든 오류는 같은 모양으로 돌려준다:
// { statusCode, code, message }  (code: 규칙 번호 R1~R8, VALIDATION, NOT_FOUND 등)
// 화면은 message를 그대로 보여 주면 된다.

/** 규칙(R1~R8) 위반으로 거절 */
export function ruleError(code: string, message: string, status = HttpStatus.CONFLICT) {
  return new HttpException({ statusCode: status, code, message }, status);
}

export function notFound(message: string) {
  return new NotFoundException({ statusCode: 404, code: 'NOT_FOUND', message });
}

export function invalid(message: string, messages: string[] = [message]) {
  return new BadRequestException({ statusCode: 400, code: 'VALIDATION', message, messages });
}

function collect(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...collect(e.children ?? []),
  ]);
}

/** ValidationPipe가 입력값 오류를 쉬운 안내 문구로 돌려주도록 */
export function validationExceptionFactory(errors: ValidationError[]) {
  const messages = collect(errors);
  return invalid(messages[0] ?? '입력한 값을 다시 확인해 주세요.', messages);
}
