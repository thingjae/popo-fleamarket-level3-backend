import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuthGuard, Roles } from '../auth/auth.js';
import { invalid, notFound, ruleError } from '../common/errors.js';
import {
  ACTIVE_STATUSES,
  expireUnpaid,
  MARKET_STATE_LABEL,
  marketState,
  type MarketState,
  thisWeekend,
} from '../common/market.js';
import { applyDeadline, isValidDateStr, todayKst } from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class ListMarketsQuery {
  @IsOptional() @Transform(emptyToUndefined) @IsString()
  keyword?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsString()
  neighborhood?: string;

  @IsOptional() @Transform(emptyToUndefined)
  @IsIn(['OPEN', 'CLOSED', 'ENDED', 'UPCOMING'], { message: '상태 필터가 올바르지 않아요.' })
  state?: MarketState | 'UPCOMING';

  @IsOptional() @IsIn(['true', 'false'])
  weekend?: 'true' | 'false';
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateMarketDto {
  @Transform(trim) @MaxLength(50, { message: '마켓 이름은 50자 이내로 입력해 주세요.' })
  @IsNotEmpty({ message: '마켓 이름을 입력해 주세요.' }) @IsString({ message: '마켓 이름을 입력해 주세요.' })
  title: string;

  @Transform(trim) @IsNotEmpty({ message: '동네를 입력해 주세요. (예: 망원동)' }) @IsString({ message: '동네를 입력해 주세요.' })
  neighborhood: string;

  @Transform(trim) @IsNotEmpty({ message: '장소를 입력해 주세요.' }) @IsString({ message: '장소를 입력해 주세요.' })
  place: string;

  @Transform(trim) @IsNotEmpty({ message: '주소를 입력해 주세요.' }) @IsString({ message: '주소를 입력해 주세요.' })
  address: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '행사일을 2026-11-01처럼 입력해 주세요.' })
  @IsString({ message: '행사일을 2026-11-01처럼 입력해 주세요.' })
  eventDate: string;

  @Matches(TIME_RE, { message: '시작 시간을 12:00처럼 입력해 주세요.' }) @IsString({ message: '시작 시간을 12:00처럼 입력해 주세요.' })
  startTime: string;

  @Matches(TIME_RE, { message: '끝나는 시간을 18:00처럼 입력해 주세요.' }) @IsString({ message: '끝나는 시간을 18:00처럼 입력해 주세요.' })
  endTime: string;

  @Max(500, { message: '부스는 500개까지 정할 수 있어요.' }) @Min(1, { message: '부스 수는 1 이상이어야 해요.' })
  @IsInt({ message: '부스 수는 숫자로 입력해 주세요.' }) @Type(() => Number)
  totalBooths: number;

  @Max(10_000_000, { message: '기본 부스비가 너무 커요.' }) @Min(0, { message: '기본 부스비는 0원 이상이어야 해요.' })
  @IsInt({ message: '기본 부스비는 숫자로 입력해 주세요.' }) @Type(() => Number)
  baseFee: number;

  @IsOptional() @IsBoolean({ message: '자동 승인은 켜기/끄기로 골라 주세요.' })
  autoApprove?: boolean;

  @IsOptional() @Transform(trim) @MaxLength(1000, { message: '소개는 1000자 이내로 입력해 주세요.' }) @IsString()
  description?: string;
}

export class UpdateMarketDto extends PartialType(CreateMarketDto) {}

@Injectable()
export class MarketsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 마켓마다 자리를 차지한 부스 수 */
  private async takenBooths(marketIds: number[]) {
    const rows = await this.prisma.application.groupBy({
      by: ['marketId'],
      where: { marketId: { in: marketIds }, status: { in: ACTIVE_STATUSES } },
      _sum: { boothCount: true },
    });
    return new Map(rows.map((r) => [r.marketId, r._sum.boothCount ?? 0]));
  }

  private view<T extends { id: number; eventDate: string; totalBooths: number }>(m: T, taken: number, now: Date) {
    const state = marketState(m.eventDate, now);
    return {
      ...m,
      state,
      stateLabel: MARKET_STATE_LABEL[state],
      applyDeadline: applyDeadline(m.eventDate),
      takenBooths: taken,
      remainingBooths: Math.max(0, m.totalBooths - taken),
    };
  }

  // B5 목록 + 검색 + 필터
  async list(q: ListMarketsQuery) {
    await expireUnpaid(this.prisma);
    const now = new Date();
    const where: Prisma.MarketWhereInput = {};
    if (q.keyword?.trim()) {
      const k = q.keyword.trim();
      where.OR = [
        { title: { contains: k, mode: 'insensitive' } },
        { place: { contains: k, mode: 'insensitive' } },
        { neighborhood: { contains: k, mode: 'insensitive' } },
        { description: { contains: k, mode: 'insensitive' } },
      ];
    }
    if (q.neighborhood) where.neighborhood = q.neighborhood;
    if (q.weekend === 'true') {
      const [sat, sun] = thisWeekend(now);
      where.eventDate = { gte: sat, lte: sun };
    }

    const markets = await this.prisma.market.findMany({
      where,
      orderBy: { eventDate: 'asc' },
      include: {
        applications: { where: { status: 'APPROVED' }, select: { keywords: true } },
      },
    });
    const taken = await this.takenBooths(markets.map((m) => m.id));
    const rows = markets.map(({ applications, ...m }) => ({
      ...this.view(m, taken.get(m.id) ?? 0, now),
      sellerCount: applications.length,
      topKeywords: keywordCounts(applications.flatMap((a) => a.keywords)).slice(0, 5),
    }));

    const filtered = q.state
      ? rows.filter((r) => (q.state === 'UPCOMING' ? r.state !== 'ENDED' : r.state === q.state))
      : rows;
    // 열릴 마켓을 먼저, 지난 마켓은 뒤로
    return filtered.sort((a, b) => Number(a.state === 'ENDED') - Number(b.state === 'ENDED'));
  }

  // B6 상세 (구매자도 봄): 남은 부스, 장비 재고, 이번 마켓 키워드, 승인된 셀러 미리보기
  async detail(id: number) {
    await expireUnpaid(this.prisma);
    const now = new Date();
    const market = await this.prisma.market.findUnique({ where: { id } });
    if (!market) throw notFound('마켓을 찾을 수 없어요.');

    const [taken, approved, equipment, used] = await Promise.all([
      this.takenBooths([id]),
      this.prisma.application.findMany({
        where: { marketId: id, status: 'APPROVED' },
        orderBy: { approvedAt: 'asc' },
        select: {
          id: true,
          boothCount: true,
          keywords: true,
          intro: true,
          saleLinks: true,
          seller: { select: { name: true } },
          photos: { select: { id: true }, orderBy: { sortOrder: 'asc' } },
        },
      }),
      this.prisma.equipment.findMany({ orderBy: { id: 'asc' } }),
      equipmentUsed(this.prisma, id),
    ]);

    return {
      ...this.view(market, taken.get(id) ?? 0, now),
      keywords: keywordCounts(approved.flatMap((a) => a.keywords)),
      sellers: approved.map((a) => ({
        applicationId: a.id,
        sellerName: a.seller.name,
        boothCount: a.boothCount,
        keywords: a.keywords,
        intro: a.intro,
        saleLinks: a.saleLinks,
        photoIds: a.photos.map((p) => p.id),
      })),
      equipment: equipment.map((e) => ({
        ...e,
        remaining: Math.max(0, e.totalQuantity - (used.get(e.id) ?? 0)),
      })),
    };
  }

  // B7 등록
  async create(dto: CreateMarketDto) {
    checkDates(dto.eventDate, dto.startTime, dto.endTime, true);
    return this.prisma.market.create({
      data: { ...dto, autoApprove: dto.autoApprove ?? false, description: dto.description ?? '' },
    });
  }

  // B7 수정
  async update(id: number, dto: UpdateMarketDto) {
    const market = await this.prisma.market.findUnique({ where: { id } });
    if (!market) throw notFound('마켓을 찾을 수 없어요.');
    checkDates(
      dto.eventDate ?? market.eventDate,
      dto.startTime ?? market.startTime,
      dto.endTime ?? market.endTime,
      dto.eventDate !== undefined && dto.eventDate !== market.eventDate,
    );
    if (dto.totalBooths !== undefined) {
      const taken = (await this.takenBooths([id])).get(id) ?? 0;
      if (dto.totalBooths < taken) {
        throw ruleError('R1', `이미 신청된 부스가 ${taken}개라 그보다 적게 줄일 수 없어요.`);
      }
    }
    return this.prisma.market.update({ where: { id }, data: dto });
  }
}

function checkDates(eventDate: string, startTime: string, endTime: string, mustBeFuture: boolean) {
  if (!isValidDateStr(eventDate)) throw invalid('없는 날짜예요. 행사일을 다시 확인해 주세요.');
  if (mustBeFuture && eventDate <= todayKst()) throw invalid('행사일은 오늘 이후로 정해 주세요.');
  if (startTime >= endTime) throw invalid('끝나는 시간은 시작 시간보다 늦어야 해요.');
}

/** 키워드를 많이 나온 순서로 [{keyword, count}] */
export function keywordCounts(all: string[]) {
  const counts = new Map<string, number>();
  for (const k of all) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .map(([keyword, count]) => ({ keyword, count }));
}

/** 이 마켓에서 진행 중인 신청이 빌린 장비 수량 (장비 번호 → 수량) */
export async function equipmentUsed(
  prisma: Pick<PrismaService, 'applicationEquipment'>,
  marketId: number,
) {
  const rows = await prisma.applicationEquipment.groupBy({
    by: ['equipmentId'],
    where: { application: { marketId, status: { in: ACTIVE_STATUSES } } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.equipmentId, r._sum.quantity ?? 0]));
}

@Controller('markets')
export class MarketsController {
  constructor(private readonly markets: MarketsService) {}

  @Get()
  list(@Query() q: ListMarketsQuery) {
    return this.markets.list(q);
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.markets.detail(id);
  }

  @Post()
  @UseGuards(AuthGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateMarketDto) {
    return this.markets.create(dto);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @Roles('ADMIN')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMarketDto) {
    return this.markets.update(id, dto);
  }
}
