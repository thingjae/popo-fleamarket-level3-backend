import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard, type AuthUser, CurrentUser, Roles } from '../auth/auth.js';
import { invalid, notFound, ruleError } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

// 사진은 서버 폴더가 아니라 DB에 저장한다. (Render 무료 서버는 재시작하면 서버의 파일이 사라짐)
// 화면에서 긴 변 1280px JPEG로 줄인 뒤 올리므로 보통 장당 100~300KB.
const MAX_BYTES = 1_500_000;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UNATTACHED = 30; // 아직 신청에 붙지 않은 사진 (지나친 업로드 방지)

@Controller('photos')
export class PhotosController {
  constructor(private readonly prisma: PrismaService) {}

  // B11 사진 올리기 (셀러)
  @Post()
  @UseGuards(AuthGuard)
  @Roles('SELLER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(@CurrentUser() me: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw invalid('사진 파일을 골라 주세요.');
    if (!ALLOWED.includes(file.mimetype)) throw invalid('사진은 JPG, PNG, WEBP만 올릴 수 있어요.');
    const pending = await this.prisma.photo.count({ where: { uploaderId: me.id, applicationId: null } });
    if (pending >= MAX_UNATTACHED) {
      throw ruleError('PHOTO_LIMIT', '아직 신청에 쓰지 않은 사진이 너무 많아요. 신청을 마친 뒤 다시 올려 주세요.');
    }
    const photo = await this.prisma.photo.create({
      data: { uploaderId: me.id, mimeType: file.mimetype, data: new Uint8Array(file.buffer) },
      select: { id: true },
    });
    return photo;
  }

  // B11 사진 보기 (누구나: 구매자도 셀러 미리보기에서 봄)
  @Get(':id')
  async show(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const photo = await this.prisma.photo.findUnique({ where: { id }, select: { mimeType: true, data: true } });
    if (!photo) throw notFound('사진을 찾을 수 없어요.');
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(photo.data));
  }
}
