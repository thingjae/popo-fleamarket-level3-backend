import { Controller, Get, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminController, InquiriesController } from './admin/admin.js';
import { AiController } from './ai/ai.js';
import {
  AdminApplicationsController,
  ApplicationsController,
  ApplicationsService,
} from './applications/applications.js';
import { AuthController, AuthGuard } from './auth/auth.js';
import { EquipmentController } from './equipment/equipment.js';
import { HealthController } from './health/health.controller.js';
import { MarketsController, MarketsService } from './markets/markets.js';
import { PhotosController } from './photos/photos.js';
import { PrismaModule } from './prisma/prisma.service.js';

@Controller()
class RootController {
  @Get()
  root() {
    return {
      name: '포포 플리마켓 API',
      health: '/health',
      message: '백엔드가 동작 중이에요. DB 연결 상태는 /health 에서 볼 수 있어요.',
    };
  }
}

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET 설정값이 없습니다.');
        return { secret: process.env.JWT_SECRET, signOptions: { expiresIn: '7d' } };
      },
    }),
  ],
  controllers: [
    RootController,
    HealthController,
    AuthController,
    MarketsController,
    EquipmentController,
    ApplicationsController,
    AdminApplicationsController,
    InquiriesController,
    AdminController,
    PhotosController,
    AiController,
  ],
  providers: [AuthGuard, MarketsService, ApplicationsService],
})
export class AppModule {}
