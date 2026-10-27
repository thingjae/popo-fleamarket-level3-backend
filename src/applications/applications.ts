import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuthGuard, type AuthUser, CurrentUser, Roles } from '../auth/auth.js';
import { invalid, notFound, ruleError } from '../common/errors.js';
import {
  ACTIVE_STATUSES,
  expireUnpaid,
  marketState,
  paymentDueAt,
  VIRTUAL_ACCOUNT,
} from '../common/market.js';
import { applyDeadline } from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { equipmentUsed } from '../markets/markets.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const MAX_PHOTOS = 10;

/** 키워드 정리: 앞뒤 공백·# 제거, 중복 제거 */
export function cleanKeywords(value: unknown) {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  return value
    .map((k) => (typeof k === 'string' ? k.replace(/^#/, '').trim() : k))
    .filter((k) => {
      if (typeof k !== 'string' || !k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export class EquipmentLineDto {
  @IsInt({ message: '장비를 골라 주세요.' }) @Type(() => Number)
  equipmentId: number;

  @Max(50, { message: '장비는 하나당 50개까지 빌릴 수 있어요.' }) @Min(1, { message: '장비 수량은 1 이상이어야 해요.' })
  @IsInt({ message: '장비 수량은 숫자로 입력해 주세요.' }) @Type(() => Number)
  quantity: number;
}

export class CreateApplicationDto {
  @IsInt({ message: '마켓을 골라 주세요.' }) @Type(() => Number)
  marketId: number;

  @Max(20, { message: '부스는 한 번에 20개까지 신청할 수 있어요.' }) @Min(1, { message: '부스 수는 1 이상이어야 해요.' })
  @IsInt({ message: '부스 수는 숫자로 입력해 주세요.' })
  boothCount: number;

  @IsOptional() @ValidateNested({ each: true }) @Type(() => EquipmentLineDto)
  @IsArray({ message: '장비 목록이 올바르지 않아요.' })
  equipment?: EquipmentLineDto[];

  @MaxLength(15, { each: true, message: '키워드는 하나당 15자 이내로 입력해 주세요.' })
  @ArrayMaxSize(10, { message: '키워드는 10개까지 입력할 수 있어요.' })
  @ArrayMinSize(3, { message: '키워드를 3개 이상 입력해 주세요. AI 소개글이 구체적으로 나와요.' })
  @IsArray({ message: '키워드를 3개 이상 입력해 주세요.' })
  @Transform(({ value }) => cleanKeywords(value))
  keywords: string[];

  @IsOptional() @MaxLength(200, { message: '메모는 200자 이내로 입력해 주세요.' }) @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  memo?: string;

  @MaxLength(600, { message: '소개글은 600자 이내로 입력해 주세요.' })
  @IsNotEmpty({ message: '소개글을 직접 쓰거나 AI로 만들어 주세요.' })
  @IsString({ message: '소개글을 직접 쓰거나 AI로 만들어 주세요.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  intro: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true, message: '판매 링크는 https://로 시작해야 해요.' })
  @ArrayMaxSize(5, { message: '판매 링크는 5개까지 넣을 수 있어요.' })
  @IsArray({ message: '판매 링크 목록이 올바르지 않아요.' })
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter(Boolean) : value))
  saleLinks?: string[];

  @IsOptional()
  @IsInt({ each: true, message: '사진 정보가 올바르지 않아요.' })
  @ArrayMaxSize(MAX_PHOTOS, { message: `사진은 ${MAX_PHOTOS}장까지 올릴 수 있어요.` })
  @IsArray({ message: '사진 정보가 올바르지 않아요.' })
  photoIds?: number[];
}

export class RejectDto {
  @IsOptional() @IsString() @MaxLength(200, { message: '거절 이유는 200자 이내로 입력해 주세요.' })
  reason?: string;
}

export class AdminApplicationsQuery {
  @IsOptional() @Transform(({ value }) => (value === '' ? undefined : value)) @Type(() => Number)
  @IsInt({ message: '마켓 번호가 올바르지 않아요.' })
  marketId?: number;

  @IsOptional() @Transform(({ value }) => (value === '' ? undefined : value))
  @IsIn(['PENDING', 'UNPAID', 'PAID', 'REJECTED', 'CANCELED', 'REFUND_PENDING'], { message: '상태 필터가 올바르지 않아요.' })
  view?: string;
}

const include = {
  market: true,
  seller: { select: { id: true, name: true, email: true, phone: true } },
  equipment: { include: { equipment: { select: { name: true } } } },
  photos: { select: { id: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ApplicationInclude;

type Full = Prisma.ApplicationGetPayload<{ include: typeof include }>;

/** 화면에 보이는 상태 이름 */
export function statusLabel(a: Pick<Full, 'status' | 'paymentStatus' | 'cancelReason'>) {
  if (a.status === 'PENDING') return '심사 대기';
  if (a.status === 'REJECTED') return '거절';
  if (a.status === 'APPROVED') return a.paymentStatus === 'PAID' ? '참가 확정' : '승인 · 입금 대기';
  if (a.cancelReason === 'PAYMENT_DUE') return '자동 취소 (입금 기한 지남)';
  if (a.paymentStatus === 'REFUND_PENDING') return '취소 · 환불 예정';
  if (a.paymentStatus === 'REFUNDED') return '취소 · 환불 완료';
  return '취소';
}

function toView(a: Full, now = new Date()) {
  const due = paymentDueAt(a.approvedAt);
  const waitingPayment = a.status === 'APPROVED' && a.paymentStatus === 'UNPAID';
  return {
    id: a.id,
    market: {
      id: a.market.id,
      title: a.market.title,
      eventDate: a.market.eventDate,
      startTime: a.market.startTime,
      endTime: a.market.endTime,
      place: a.market.place,
      neighborhood: a.market.neighborhood,
      state: marketState(a.market.eventDate, now),
    },
    seller: a.seller,
    boothCount: a.boothCount,
    baseFee: a.market.baseFee,
    equipment: a.equipment.map((e) => ({
      equipmentId: e.equipmentId,
      name: e.equipment.name,
      quantity: e.quantity,
      unitPrice: e.unitPrice,
    })),
    keywords: a.keywords,
    memo: a.memo,
    intro: a.intro,
    saleLinks: a.saleLinks,
    photoIds: a.photos.map((p) => p.id),
    status: a.status,
    paymentStatus: a.paymentStatus,
    statusLabel: statusLabel(a),
    totalFee: a.totalFee,
    paymentDueAt: waitingPayment ? due : null,
    account: waitingPayment
      ? { ...VIRTUAL_ACCOUNT, depositor: `${a.id}${a.seller.name}`.replace(/\s/g, '') }
      : null,
    canCancel: ACTIVE_STATUSES.includes(a.status) && now <= applyDeadline(a.market.eventDate),
    cancelDeadline: applyDeadline(a.market.eventDate),
    cancelReason: a.cancelReason,
    rejectReason: a.rejectReason,
    createdAt: a.createdAt,
    approvedAt: a.approvedAt,
    paidAt: a.paidAt,
    canceledAt: a.canceledAt,
  };
}

function won(n: number) {
  return `${n.toLocaleString('ko-KR')}원`;
}

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  // B12 부스 신청. 규칙 R1, R2, R3, R7 을 서버에서 확인하고, 금액도 서버가 계산한다.
  async create(me: AuthUser, dto: CreateApplicationDto) {
    await expireUnpaid(this.prisma);
    const lines = dto.equipment ?? [];
    if (new Set(lines.map((l) => l.equipmentId)).size !== lines.length) {
      throw invalid('같은 장비가 두 번 들어 있어요. 수량을 합쳐 주세요.');
    }
    const s = `"${this.prisma.schema}"`;

    return this.prisma.$transaction(async (tx) => {
      // 같은 마켓에 동시에 신청이 들어와도 하나씩 차례로 확인하도록 마켓을 잠근다 (정원·재고가 뚫리지 않게)
      await tx.$executeRawUnsafe(`SELECT id FROM ${s}.markets WHERE id = $1 FOR UPDATE`, dto.marketId);
      const market = await tx.market.findUnique({ where: { id: dto.marketId } });
      if (!market) throw notFound('마켓을 찾을 수 없어요.');

      // R2 신청 마감 (행사 3일 전 23:59)
      const now = new Date();
      if (now > applyDeadline(market.eventDate)) {
        throw ruleError('R2', '신청이 마감됐어요. 마켓 화면에서 주최측에 문의를 남겨 주세요.');
      }

      // R7 같은 마켓에 진행 중인 신청은 1건
      const mine = await tx.application.findFirst({
        where: { marketId: market.id, sellerId: me.id, status: { in: ACTIVE_STATUSES } },
      });
      if (mine) {
        throw ruleError('R7', '이 마켓에 이미 신청한 내역이 있어요. 부스를 더 원하면 취소 후 부스 수를 늘려 다시 신청해 주세요.');
      }

      // R1 부스 정원 (심사 대기 + 승인이 자리를 차지)
      const taken =
        (await tx.application.aggregate({
          where: { marketId: market.id, status: { in: ACTIVE_STATUSES } },
          _sum: { boothCount: true },
        }))._sum.boothCount ?? 0;
      const remaining = market.totalBooths - taken;
      if (dto.boothCount > remaining) {
        throw ruleError(
          'R1',
          remaining <= 0
            ? '부스가 모두 찼어요. 다른 마켓을 확인해 주세요.'
            : `남은 부스가 ${remaining}개라 ${dto.boothCount}개를 신청할 수 없어요.`,
        );
      }

      // R3 장비 재고 (이 마켓에서 이미 빌린 수량 + 이번 신청 ≤ 보유 수량)
      const equipment = await tx.equipment.findMany({ where: { id: { in: lines.map((l) => l.equipmentId) } } });
      const used = await equipmentUsed(tx, market.id);
      for (const line of lines) {
        const eq = equipment.find((e) => e.id === line.equipmentId);
        if (!eq) throw invalid('없는 장비가 들어 있어요. 장비를 다시 골라 주세요.');
        const left = eq.totalQuantity - (used.get(eq.id) ?? 0);
        if (line.quantity > left) {
          throw ruleError(
            'R3',
            left <= 0
              ? `${eq.name}은(는) 이번 마켓에 남은 수량이 없어요. 직접 가져오셔도 돼요.`
              : `${eq.name}은(는) 이번 마켓에 ${left}개만 남았어요.`,
          );
        }
      }

      // 사진: 내가 올렸고 아직 어느 신청에도 붙지 않은 사진만
      const photoIds = [...new Set(dto.photoIds ?? [])];
      if (photoIds.length) {
        const ok = await tx.photo.count({
          where: { id: { in: photoIds }, uploaderId: me.id, applicationId: null },
        });
        if (ok !== photoIds.length) throw invalid('사진 정보가 올바르지 않아요. 사진을 다시 올려 주세요.');
      }

      // 금액은 화면에서 보낸 값을 믿지 않고 서버가 계산한다
      const totalFee =
        market.baseFee * dto.boothCount +
        lines.reduce((sum, l) => sum + equipment.find((e) => e.id === l.equipmentId)!.unitPrice * l.quantity, 0);

      const created = await tx.application.create({
        data: {
          marketId: market.id,
          sellerId: me.id,
          boothCount: dto.boothCount,
          keywords: dto.keywords,
          memo: dto.memo ?? '',
          intro: dto.intro,
          saleLinks: dto.saleLinks ?? [],
          totalFee,
          // 자동 승인 마켓은 바로 승인 → 입금 기한 3일 시작
          status: market.autoApprove ? 'APPROVED' : 'PENDING',
          approvedAt: market.autoApprove ? now : null,
          equipment: {
            create: lines.map((l) => ({
              equipmentId: l.equipmentId,
              quantity: l.quantity,
              unitPrice: equipment.find((e) => e.id === l.equipmentId)!.unitPrice,
            })),
          },
        },
      });
      for (const [i, id] of photoIds.entries()) {
        await tx.photo.update({ where: { id }, data: { applicationId: created.id, sortOrder: i } });
      }
      const full = await tx.application.findUniqueOrThrow({ where: { id: created.id }, include });
      return {
        ...toView(full, now),
        message: market.autoApprove
          ? `신청이 바로 승인됐어요. 3일 안에 ${won(totalFee)}을 입금해 주세요.`
          : '신청이 접수됐어요. 주최측 심사 후 승인되면 입금 안내가 보여요.',
      };
    });
  }

  // B13 내 신청
  async mine(me: AuthUser) {
    await expireUnpaid(this.prisma);
    const list = await this.prisma.application.findMany({
      where: { sellerId: me.id },
      include,
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return list.map((a) => toView(a, now));
  }

  // 신청 하나 보기: 내 신청이거나 관리자만 (R6)
  async one(me: AuthUser, id: number) {
    await expireUnpaid(this.prisma);
    const a = await this.prisma.application.findUnique({ where: { id }, include });
    if (!a) throw notFound('신청을 찾을 수 없어요.');
    if (me.role !== 'ADMIN' && a.sellerId !== me.id) {
      throw ruleError('R6', '내 신청만 볼 수 있어요.', 403);
    }
    return toView(a);
  }

  // B14 셀러 취소 (R4 행사 3일 전까지, R6 내 신청만)
  async cancel(me: AuthUser, id: number) {
    await expireUnpaid(this.prisma);
    const a = await this.prisma.application.findUnique({ where: { id }, include });
    if (!a) throw notFound('신청을 찾을 수 없어요.');
    if (a.sellerId !== me.id) throw ruleError('R6', '내 신청만 취소할 수 있어요.', 403);
    if (!ACTIVE_STATUSES.includes(a.status)) {
      throw ruleError('ALREADY', a.cancelReason === 'PAYMENT_DUE' ? '입금 기한이 지나 이미 자동으로 취소된 신청이에요.' : '이미 끝난 신청이에요.');
    }
    if (new Date() > applyDeadline(a.market.eventDate)) {
      throw ruleError('R4', '행사 3일 전이 지나 취소할 수 없어요. 주최측에 문의해 주세요.');
    }
    const updated = await this.prisma.application.update({
      where: { id },
      data: {
        status: 'CANCELED',
        cancelReason: 'SELLER',
        canceledAt: new Date(),
        // 이미 입금했다면 환불 예정으로 (실제 돈은 움직이지 않는다)
        paymentStatus: a.paymentStatus === 'PAID' ? 'REFUND_PENDING' : a.paymentStatus,
      },
      include,
    });
    return {
      ...toView(updated),
      message: a.paymentStatus === 'PAID' ? '신청을 취소했어요. 입금한 금액은 환불 예정이에요.' : '신청을 취소했어요.',
    };
  }

  // B15 관리자: 전체 신청
  async adminList(q: AdminApplicationsQuery) {
    await expireUnpaid(this.prisma);
    const where: Prisma.ApplicationWhereInput = {};
    if (q.marketId) where.marketId = q.marketId;
    if (q.view === 'PENDING') where.status = 'PENDING';
    if (q.view === 'UNPAID') Object.assign(where, { status: 'APPROVED', paymentStatus: 'UNPAID' });
    if (q.view === 'PAID') Object.assign(where, { status: 'APPROVED', paymentStatus: 'PAID' });
    if (q.view === 'REJECTED') where.status = 'REJECTED';
    if (q.view === 'CANCELED') where.status = 'CANCELED';
    if (q.view === 'REFUND_PENDING') where.paymentStatus = 'REFUND_PENDING';
    const list = await this.prisma.application.findMany({
      where,
      include,
      orderBy: [{ market: { eventDate: 'asc' } }, { createdAt: 'asc' }],
    });
    const now = new Date();
    return list.map((a) => toView(a, now));
  }

  /** B16 관리자 처리: 상태가 맞을 때만 바꾼다 */
  private async adminAct(id: number, check: (a: Full) => string | null, data: Prisma.ApplicationUpdateInput) {
    await expireUnpaid(this.prisma);
    const a = await this.prisma.application.findUnique({ where: { id }, include });
    if (!a) throw notFound('신청을 찾을 수 없어요.');
    const problem = check(a);
    if (problem) throw ruleError(a.cancelReason === 'PAYMENT_DUE' ? 'R5' : 'STATE', problem);
    return toView(await this.prisma.application.update({ where: { id }, data, include }));
  }

  approve(id: number) {
    return this.adminAct(id, (a) => (a.status === 'PENDING' ? null : '심사 대기 중인 신청만 승인할 수 있어요.'), {
      status: 'APPROVED',
      approvedAt: new Date(),
    });
  }

  reject(id: number, reason?: string) {
    return this.adminAct(id, (a) => (a.status === 'PENDING' ? null : '심사 대기 중인 신청만 거절할 수 있어요.'), {
      status: 'REJECTED',
      rejectReason: reason?.trim() || '주최측 심사 결과 이번에는 함께하기 어려워요.',
    });
  }

  confirmPayment(id: number) {
    return this.adminAct(
      id,
      (a) => {
        if (a.cancelReason === 'PAYMENT_DUE') return '입금 기한이 지나 자동으로 취소된 신청이에요.';
        return a.status === 'APPROVED' && a.paymentStatus === 'UNPAID' ? null : '승인 후 입금 대기 중인 신청만 입금 확인할 수 있어요.';
      },
      { paymentStatus: 'PAID', paidAt: new Date() },
    );
  }

  refund(id: number) {
    return this.adminAct(id, (a) => (a.paymentStatus === 'REFUND_PENDING' ? null : '환불 예정인 신청만 환불 완료할 수 있어요.'), {
      paymentStatus: 'REFUNDED',
    });
  }
}

@Controller('applications')
@UseGuards(AuthGuard)
export class ApplicationsController {
  constructor(private readonly apps: ApplicationsService) {}

  @Post()
  @Roles('SELLER')
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateApplicationDto) {
    return this.apps.create(me, dto);
  }

  @Get('mine')
  @Roles('SELLER')
  mine(@CurrentUser() me: AuthUser) {
    return this.apps.mine(me);
  }

  @Get(':id')
  one(@CurrentUser() me: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.apps.one(me, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('SELLER')
  cancel(@CurrentUser() me: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.apps.cancel(me, id);
  }
}

@Controller('admin/applications')
@UseGuards(AuthGuard)
@Roles('ADMIN')
export class AdminApplicationsController {
  constructor(private readonly apps: ApplicationsService) {}

  @Get()
  list(@Query() q: AdminApplicationsQuery) {
    return this.apps.adminList(q);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseIntPipe) id: number) {
    return this.apps.approve(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectDto) {
    return this.apps.reject(id, dto.reason);
  }

  @Post(':id/confirm-payment')
  @HttpCode(200)
  confirmPayment(@Param('id', ParseIntPipe) id: number) {
    return this.apps.confirmPayment(id);
  }

  @Post(':id/refund')
  @HttpCode(200)
  refund(@Param('id', ParseIntPipe) id: number) {
    return this.apps.refund(id);
  }
}
