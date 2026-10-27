import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard, type AuthUser, CurrentUser, Roles } from '../auth/auth.js';
import { notFound } from '../common/errors.js';
import { ACTIVE_STATUSES, expireUnpaid, marketState, MARKET_STATE_LABEL } from '../common/market.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { reseed } from '../seed/seed.js';

export class CreateInquiryDto {
  @IsInt({ message: '마켓을 골라 주세요.' }) @Type(() => Number)
  marketId: number;

  @MaxLength(1000, { message: '문의는 1000자 이내로 입력해 주세요.' })
  @IsNotEmpty({ message: '문의 내용을 입력해 주세요.' })
  @IsString({ message: '문의 내용을 입력해 주세요.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  content: string;
}

class UpdateInquiryDto {
  @IsIn(['NEW', 'DONE'], { message: '처리 상태가 올바르지 않아요.' })
  status: 'NEW' | 'DONE';
}

class StatsQuery {
  @IsOptional() @Transform(({ value }) => (value === '' ? undefined : value)) @Type(() => Number)
  @IsInt({ message: '마켓 번호가 올바르지 않아요.' })
  marketId?: number;
}

// B17 문의 남기기: 신청 마감 뒤 셀러가 주최측에 연락하는 창구
@Controller('inquiries')
@UseGuards(AuthGuard)
export class InquiriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @Roles('SELLER')
  async create(@CurrentUser() me: AuthUser, @Body() dto: CreateInquiryDto) {
    const market = await this.prisma.market.findUnique({ where: { id: dto.marketId } });
    if (!market) throw notFound('마켓을 찾을 수 없어요.');
    await this.prisma.inquiry.create({ data: { marketId: market.id, sellerId: me.id, content: dto.content } });
    return { message: '문의를 보냈어요. 주최측이 확인 후 연락드려요.' };
  }
}

@Controller('admin')
@UseGuards(AuthGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  // B17 문의함
  @Get('inquiries')
  inquiries() {
    return this.prisma.inquiry.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        market: { select: { id: true, title: true, eventDate: true } },
        seller: { select: { name: true, email: true, phone: true } },
      },
    });
  }

  @Patch('inquiries/:id')
  async updateInquiry(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInquiryDto) {
    const found = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!found) throw notFound('문의를 찾을 수 없어요.');
    return this.prisma.inquiry.update({ where: { id }, data: { status: dto.status } });
  }

  // B18 현황 숫자: 남은 부스 / 심사 대기 / 입금 확인 금액 (+ 입금 대기, 새 문의)
  @Get('stats')
  async stats(@Query() q: StatsQuery) {
    await expireUnpaid(this.prisma);
    const now = new Date();
    const markets = await this.prisma.market.findMany({
      where: q.marketId ? { id: q.marketId } : {},
      orderBy: { eventDate: 'asc' },
      include: { applications: { select: { status: true, paymentStatus: true, boothCount: true, totalFee: true } } },
    });

    const rows = markets.map((m) => {
      const active = m.applications.filter((a) => ACTIVE_STATUSES.includes(a.status));
      const taken = active.reduce((s, a) => s + a.boothCount, 0);
      const state = marketState(m.eventDate, now);
      return {
        marketId: m.id,
        title: m.title,
        eventDate: m.eventDate,
        state,
        stateLabel: MARKET_STATE_LABEL[state],
        totalBooths: m.totalBooths,
        remainingBooths: Math.max(0, m.totalBooths - taken),
        pending: m.applications.filter((a) => a.status === 'PENDING').length,
        unpaid: m.applications.filter((a) => a.status === 'APPROVED' && a.paymentStatus === 'UNPAID').length,
        paidAmount: m.applications
          .filter((a) => a.status === 'APPROVED' && a.paymentStatus === 'PAID')
          .reduce((s, a) => s + a.totalFee, 0),
        refundPending: m.applications.filter((a) => a.paymentStatus === 'REFUND_PENDING').length,
      };
    });

    // 숫자 카드는 아직 끝나지 않은 마켓 기준 (특정 마켓을 고르면 그 마켓)
    const target = q.marketId ? rows : rows.filter((r) => r.state !== 'ENDED');
    const sum = (k: 'remainingBooths' | 'pending' | 'unpaid' | 'paidAmount' | 'refundPending') =>
      target.reduce((s, r) => s + r[k], 0);
    return {
      marketId: q.marketId ?? null,
      upcomingMarkets: rows.filter((r) => r.state !== 'ENDED').length,
      remainingBooths: sum('remainingBooths'),
      pending: sum('pending'),
      paidAmount: sum('paidAmount'),
      unpaid: sum('unpaid'),
      refundPending: sum('refundPending'),
      newInquiries: await this.prisma.inquiry.count({ where: { status: 'NEW' } }),
      byMarket: rows,
    };
  }

  // B19 가상 데이터 다시 채우기
  @Post('seed/reset')
  @HttpCode(200)
  async reset() {
    const counts = await reseed(this.prisma);
    return { message: '가상 데이터를 처음 상태로 다시 채웠어요.', ...counts };
  }
}
