import { existsSync } from 'node:fs';

// 로컬에서는 backend/.env 를 읽는다. (Render에서는 설정값이 바로 들어오므로 파일이 없다)
if (existsSync('.env')) process.loadEnvFile('.env');

const { NestFactory } = await import('@nestjs/core');
const { ValidationPipe } = await import('@nestjs/common');
const { AppModule } = await import('./app.module.js');
const { validationExceptionFactory } = await import('./common/errors.js');

// 허용할 프론트엔드 주소 목록. 쉼표로 여러 개를 받고, 끝의 / 는 지운다.
// (주소가 한 글자만 달라도 브라우저가 CORS로 막는다)
function allowedOrigins(): string[] {
  return (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3100')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origins = allowedOrigins();
  app.enableCors({ origin: origins });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // 칸마다 가장 먼저 걸린 안내 하나만 보여 준다
      stopAtFirstError: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  const port = Number(process.env.PORT ?? 4100);
  await app.listen(port, '0.0.0.0');
  console.log(`백엔드 실행: http://localhost:${port}  (허용 프론트: ${origins.join(', ')})`);
}
await bootstrap();
