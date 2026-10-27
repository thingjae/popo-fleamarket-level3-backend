import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // prisma generate(코드 만들기)는 DB 주소가 없어도 되도록 빈 값을 허용한다.
    // migrate deploy 처럼 실제로 DB에 붙는 명령은 DATABASE_URL 이 꼭 있어야 한다.
    url: process.env.DATABASE_URL ?? '',
  },
});
