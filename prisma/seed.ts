// 명령으로 가상 데이터 다시 채우기: npm run seed
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { reseed } from '../src/seed/seed.js';

const prisma = new PrismaService();
try {
  console.log('가상 데이터를 다시 채웠어요:', await reseed(prisma));
} finally {
  await prisma.$disconnect();
}
