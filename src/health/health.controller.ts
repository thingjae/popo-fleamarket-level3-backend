import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

// 백엔드 주소 뒤에 /health 를 붙여 열면 DB 연결 상태가 보인다.
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        db: 'connected',
        message: 'DB에 정상적으로 연결되어 있어요.',
        ai: process.env.GPT_API_KEY ? 'configured' : 'missing',
        responseMs: Date.now() - started,
        time: new Date().toISOString(),
      };
    } catch (e) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: 'error',
        db: 'disconnected',
        message: 'DB에 연결할 수 없어요. DATABASE_URL 설정값을 확인해 주세요.',
        detail: e instanceof Error ? e.message.split('\n')[0] : String(e),
        time: new Date().toISOString(),
      };
    }
  }
}
