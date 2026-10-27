import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { cleanKeywords } from '../applications/applications.js';
import { AuthGuard, type AuthUser, CurrentUser, Roles } from '../auth/auth.js';
import { ruleError } from '../common/errors.js';

export class SellerIntroDto {
  @MaxLength(15, { each: true, message: '키워드는 하나당 15자 이내로 입력해 주세요.' })
  @ArrayMaxSize(10, { message: '키워드는 10개까지 입력할 수 있어요.' })
  @ArrayMinSize(3, { message: '키워드를 3개 이상 입력해 주세요. AI 소개글이 구체적으로 나와요.' })
  @IsArray({ message: '키워드를 3개 이상 입력해 주세요.' })
  @Transform(({ value }) => cleanKeywords(value))
  keywords: string[];

  @IsOptional() @MaxLength(200, { message: '메모는 200자 이내로 입력해 주세요.' }) @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  memo?: string;
}

// 피상적인 글을 막는 규칙: 키워드를 재료로만, 지어내지 않기 (기획서 8장)
const SYSTEM_PROMPT = [
  '너는 마포구 오프라인 플리마켓 "포포 플리마켓"의 셀러 소개글을 쓰는 도우미야.',
  '규칙:',
  '1. 주어진 키워드를 빠짐없이, 구체적으로 문장에 넣는다.',
  '2. 키워드와 메모에 없는 브랜드, 상품, 가격, 경력 같은 사실은 절대 지어내지 않는다.',
  '3. 2~3문장, 존댓말(~해요체)로 쓴다. 첫 문장은 활동명으로 시작한다.',
  '4. 과장 광고 말투를 쓰지 않는다. ("최고의", "놓치지 마세요", "강력 추천" 등 금지)',
  '5. 이모지, 해시태그, 따옴표 없이 소개글 본문만 출력한다.',
].join('\n');

// 셀러 한 명이 짧은 시간에 너무 많이 부르지 않게 (비용 보호)
const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALLS = 10;
const calls = new Map<number, number[]>();

// B10 키워드로 셀러 소개글 만들기 (GPT API). 키는 백엔드 설정값 GPT_API_KEY 에만 있다.
@Controller('ai')
@UseGuards(AuthGuard)
export class AiController {
  @Post('seller-intro')
  @HttpCode(200)
  @Roles('SELLER')
  async sellerIntro(@CurrentUser() me: AuthUser, @Body() dto: SellerIntroDto) {
    const key = process.env.GPT_API_KEY;
    if (!key) throw ruleError('AI_OFF', 'AI 기능이 아직 설정되지 않았어요. 소개글을 직접 써 주세요.', 503);

    const now = Date.now();
    const recent = (calls.get(me.id) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_CALLS) {
      throw ruleError('AI_LIMIT', 'AI 소개글은 10분에 10번까지 만들 수 있어요. 잠시 뒤 다시 시도하거나 직접 고쳐 주세요.', 429);
    }
    calls.set(me.id, [...recent, now]);

    const userPrompt = [
      `활동명: ${me.name}`,
      `키워드: ${dto.keywords.join(', ')}`,
      dto.memo ? `메모: ${dto.memo}` : '메모: (없음)',
    ].join('\n');

    const model = process.env.GPT_MODEL || 'gpt-5.4-mini';
    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw ruleError('AI_FAIL', 'AI가 지금 응답하지 않아요. 잠시 뒤 다시 시도하거나 직접 써 주세요.', 502);
    }
    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    } | null;
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!res.ok || !text) {
      console.error('GPT 오류:', res.status, data?.error?.message);
      throw ruleError('AI_FAIL', 'AI가 소개글을 만들지 못했어요. 잠시 뒤 다시 시도하거나 직접 써 주세요.', 502);
    }

    // 키워드가 실제로 들어갔는지 확인해서 화면에 알려 준다 (셀러가 고칠 때 참고)
    const missing = dto.keywords.filter((k) => !text.includes(k));
    return { intro: text, model, keywords: dto.keywords, missingKeywords: missing };
  }
}
