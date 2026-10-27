import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthGuard, Roles } from '../auth/auth.js';
import { notFound, ruleError } from '../common/errors.js';
import { ACTIVE_STATUSES } from '../common/market.js';
import { PrismaService } from '../prisma/prisma.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateEquipmentDto {
  @Transform(trim) @MaxLength(30, { message: '장비 이름은 30자 이내로 입력해 주세요.' })
  @IsNotEmpty({ message: '장비 이름을 입력해 주세요.' }) @IsString({ message: '장비 이름을 입력해 주세요.' })
  name: string;

  @Max(1_000_000, { message: '대여료가 너무 커요.' }) @Min(0, { message: '대여료는 0원 이상이어야 해요.' })
  @IsInt({ message: '대여료는 숫자로 입력해 주세요.' }) @Type(() => Number)
  unitPrice: number;

  @Max(10_000, { message: '보유 수량이 너무 커요.' }) @Min(0, { message: '보유 수량은 0 이상이어야 해요.' })
  @IsInt({ message: '보유 수량은 숫자로 입력해 주세요.' }) @Type(() => Number)
  totalQuantity: number;

  @IsOptional() @Transform(trim) @MaxLength(200, { message: '설명은 200자 이내로 입력해 주세요.' }) @IsString()
  description?: string;
}

export class UpdateEquipmentDto extends PartialType(CreateEquipmentDto) {}

// B8, B9 장비: 보는 건 누구나, 등록·수정·삭제는 관리자만 (R6)
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.equipment.findMany({ orderBy: { id: 'asc' } });
  }

  @Post()
  @UseGuards(AuthGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateEquipmentDto) {
    return this.prisma.equipment.create({ data: { ...dto, description: dto.description ?? '' } });
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @Roles('ADMIN')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEquipmentDto) {
    const found = await this.prisma.equipment.findUnique({ where: { id } });
    if (!found) throw notFound('장비를 찾을 수 없어요.');
    return this.prisma.equipment.update({ where: { id }, data: dto });
  }

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @Roles('ADMIN')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const found = await this.prisma.equipment.findUnique({ where: { id } });
    if (!found) throw notFound('장비를 찾을 수 없어요.');

    // R8 진행 중인 신청(심사 대기·승인)에 쓰이는 장비는 삭제할 수 없다
    const inUse = await this.prisma.applicationEquipment.count({
      where: { equipmentId: id, application: { status: { in: ACTIVE_STATUSES } } },
    });
    if (inUse > 0) {
      throw ruleError('R8', `이 장비를 빌린 신청이 ${inUse}건 있어 삭제할 수 없어요. 수량을 0으로 바꾸면 더 이상 빌려줄 수 없어요.`);
    }
    await this.prisma.$transaction([
      // 끝난 신청(거절·취소)의 장비 기록은 정리한다. 신청 금액(total_fee)은 그대로 남는다.
      this.prisma.applicationEquipment.deleteMany({ where: { equipmentId: id } }),
      this.prisma.equipment.delete({ where: { id } }),
    ]);
    return { message: `${found.name}을(를) 삭제했어요.` };
  }
}
