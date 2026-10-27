import {
  Body,
  type CanActivate,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Post,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { invalid, ruleError } from '../common/errors.js';
import { normalizePhone, PHONE_MESSAGE, PHONE_RE } from '../common/person.js';
import type { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

// 로그인하면 서버가 "출입증(JWT)"을 준다. 화면은 요청마다 Authorization: Bearer <출입증> 으로 보여 준다.
// 출입증에는 회원 번호와 역할만 들어 있고, 서버의 비밀값(JWT_SECRET)으로 서명되어 위조할 수 없다.

export type AuthUser = { id: number; role: Role; name: string };

const ROLES_KEY = 'roles';
/** 이 기능을 쓸 수 있는 역할 (R6) */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** 요청한 사람 (가드를 통과한 뒤에만 들어 있다) */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    // R9 로그인 필요
    if (!token) throw ruleError('R9', '로그인이 필요해요.', 401);

    let payload: { sub: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw ruleError('R9', '로그인이 만료됐어요. 다시 로그인해 주세요.', 401);
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw ruleError('R9', '회원 정보를 찾을 수 없어요. 다시 로그인해 주세요.', 401);
    req.user = { id: user.id, role: user.role, name: user.name };

    // R6 역할 권한
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles && !roles.includes(user.role)) {
      throw ruleError(
        'R6',
        roles.includes('ADMIN') ? '관리자만 할 수 있어요.' : '셀러 계정으로만 할 수 있어요.',
        403,
      );
    }
    return true;
  }
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class LoginDto {
  @Transform(lower)
  @IsEmail({}, { message: '이메일을 popo@example.com처럼 입력해 주세요.' })
  email: string;

  @IsString({ message: '비밀번호를 입력해 주세요.' })
  @IsNotEmpty({ message: '비밀번호를 입력해 주세요.' })
  password: string;
}

export class SignupDto {
  @Transform(lower)
  @IsEmail({}, { message: '이메일을 popo@example.com처럼 입력해 주세요.' })
  email: string;

  @MaxLength(72, { message: '비밀번호는 72자 이내로 입력해 주세요.' })
  @MinLength(8, { message: '비밀번호는 8자 이상으로 입력해 주세요.' })
  @IsString({ message: '비밀번호를 입력해 주세요.' })
  password: string;

  @Transform(trim)
  @MaxLength(30, { message: '활동명은 30자 이내로 입력해 주세요.' })
  @IsNotEmpty({ message: '활동명(가게 이름)을 입력해 주세요.' })
  @IsString({ message: '활동명(가게 이름)을 입력해 주세요.' })
  name: string;

  @Transform(({ value }) => (typeof value === 'string' ? normalizePhone(value) : value))
  @Matches(PHONE_RE, { message: PHONE_MESSAGE })
  @IsString({ message: PHONE_MESSAGE })
  phone: string;
}

function publicUser(u: { id: number; email: string; role: Role; name: string; phone: string }) {
  return { id: u.id, email: u.email, role: u.role, name: u.name, phone: u.phone };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private async issue(u: { id: number; email: string; role: Role; name: string; phone: string }) {
    return { token: await this.jwt.signAsync({ sub: u.id, role: u.role }), user: publicUser(u) };
  }

  // B2 셀러 회원가입 (관리자 계정은 가상 데이터로 미리 만든다)
  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw invalid('이미 가입된 이메일이에요. 로그인해 주세요.');
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: 'SELLER',
        name: dto.name,
        phone: dto.phone,
      },
    });
    return this.issue(user);
  }

  // B3 로그인
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // 이메일이 없는지 비밀번호가 틀린지 구분해서 알려 주지 않는다 (남의 가입 여부를 알 수 없게)
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw ruleError('LOGIN', '이메일이나 비밀번호가 맞지 않아요.', 401);
    }
    return this.issue(user);
  }

  // B4 내 정보
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() me: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    return publicUser(user);
  }
}
