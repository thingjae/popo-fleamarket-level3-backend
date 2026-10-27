# 포포 플리마켓 · 백엔드 (Level 3)

마포구 오프라인 플리마켓을 **열고(주최측), 참가하고(셀러), 미리 구경하는(구매자)** 플랫폼의 **처리 서버(API)**입니다.
기획 내용은 [기획서.md](기획서.md)에 있습니다. 모든 인물, 단체, 계좌번호, 연락처는 **가상**이며 실제 결제는 하지 않습니다.

> ⏳ **처음 접속이 느릴 수 있어요.** Render 무료 서버라 15분 동안 아무도 쓰지 않으면 잠들고, 다음 첫 요청에 1분 가까이 걸립니다. 고장이 아니에요.

- 배포 주소: https://popo-fleamarket-level3-backend.onrender.com
- 프론트엔드 화면: https://popo-fleamarket-level3-frontend.vercel.app
- DB 연결 확인: https://popo-fleamarket-level3-backend.onrender.com/health
- 프론트엔드 저장소: https://github.com/thingjae/popo-fleamarket-level3-frontend

## 기술

| 부분 | 사용 |
| --- | --- |
| 서버 | NestJS 12 (TypeScript) |
| DB | PostgreSQL (Render), 이 과제 전용 스키마 `level3` |
| DB 도구 | Prisma 7 (`@prisma/adapter-pg`) |
| 로그인 | JWT 출입증 + bcryptjs 비밀번호 해시 |
| AI | OpenAI GPT API (`gpt-5.4-mini`) — 키워드로 셀러 소개글 만들기 |
| 사진 | 브라우저에서 줄인 사진을 DB에 저장 (무료 서버는 재시작하면 파일이 사라지기 때문) |

## 역할

| 역할 | 할 수 있는 일 |
| --- | --- |
| 관리자 (주최측) | 마켓 등록·수정(자동 승인 설정), 신청 승인·거절, 입금 확인, 환불 완료, 장비 등록·수정·삭제, 문의함, 현황, 가상 데이터 다시 채우기 |
| 셀러 (회원가입) | 부스 신청, AI 소개글, 사진 업로드, **내 신청만** 보기·취소, 마감 뒤 문의 |
| 구매자 (로그인 없음) | 마켓 목록·상세, 키워드 모음, 승인된 셀러 미리보기 |

역할 확인은 서버의 Guard가 합니다. 셀러 출입증으로 관리자 API를 직접 불러도 `403 R6`으로 거절됩니다.

## 서버가 지키는 규칙

| 코드 | 규칙 |
| --- | --- |
| R1 | 부스 정원: 심사 대기 + 승인 부스 합이 전체 부스를 넘을 수 없다 (동시에 신청해도 하나만 성공) |
| R2 | 신청 마감: 행사일 3일 전 23:59까지 |
| R3 | 장비 재고: 마켓마다 빌린 수량 합이 보유 수량을 넘을 수 없다 |
| R4 | 취소 기한: 행사일 3일 전 23:59까지 |
| R5 | 입금 기한: 승인 후 3일 안에 입금 확인이 안 되면 자동 취소 (읽을 때마다 확인하는 방식, 잠드는 무료 서버 대응) |
| R6 | 역할 권한: 관리 기능은 관리자만, 셀러는 자기 신청만 |
| R7 | 같은 마켓에 진행 중인 신청은 셀러당 1건 |
| R8 | 진행 중인 신청에 쓰이는 장비는 삭제할 수 없다 |
| R9 | 신청, 내 신청, AI, 문의는 로그인 필요 |

금액(기본 부스비 × 부스 수 + 장비 대여료)은 화면에서 보낸 값을 믿지 않고 **서버가 계산**합니다.

## API

| 기능 | 주소 | 누가 |
| --- | --- | --- |
| DB 연결 상태 | `GET /health` | 누구나 |
| 셀러 가입 / 로그인 / 내 정보 | `POST /auth/signup`, `POST /auth/login`, `GET /auth/me` | 누구나 / 로그인 |
| 마켓 목록 (검색·필터) | `GET /markets?keyword=&neighborhood=&state=&weekend=true` | 누구나 |
| 마켓 상세 (남은 부스, 장비 재고, 키워드 모음, 셀러 미리보기) | `GET /markets/:id` | 누구나 |
| 마켓 등록·수정 | `POST /markets`, `PATCH /markets/:id` | 관리자 |
| 장비 목록 / 등록·수정·삭제 | `GET /equipment`, `POST`, `PATCH`, `DELETE /equipment/:id` | 누구나 / 관리자 |
| AI 소개글 | `POST /ai/seller-intro` | 셀러 |
| 사진 올리기 / 보기 | `POST /photos`, `GET /photos/:id` | 셀러 / 누구나 |
| 부스 신청 / 내 신청 / 취소 | `POST /applications`, `GET /applications/mine`, `POST /applications/:id/cancel` | 셀러 |
| 신청 관리 | `GET /admin/applications`, `POST /admin/applications/:id/{approve,reject,confirm-payment,refund}` | 관리자 |
| 문의 남기기 / 문의함 | `POST /inquiries`, `GET /admin/inquiries`, `PATCH /admin/inquiries/:id` | 셀러 / 관리자 |
| 현황 숫자 | `GET /admin/stats` | 관리자 |
| 가상 데이터 다시 채우기 | `POST /admin/seed/reset` | 관리자 |

## Render에 올리기

**New → Web Service**에서 이 저장소를 고르고 아래처럼 넣습니다. 지역은 DB와 같은 **Singapore**.

| 칸 | 값 |
| --- | --- |
| Language | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npx prisma migrate deploy && npm run start:prod` |
| Instance Type | Free |

**설정값 (Environment Variables)**

| 이름 | 뜻 |
| --- | --- |
| `DATABASE_URL` | Render DB의 **Internal** 주소 끝에 `?schema=level3` |
| `JWT_SECRET` | 로그인 출입증 서명용 비밀 문자열 (길고 무작위로) |
| `GPT_API_KEY` | GPT API 키. **여기(서버 설정값)에만** 넣고 GitHub·프론트엔드에는 절대 넣지 않음 |
| `GPT_MODEL` | (선택) 기본 `gpt-5.4-mini` |
| `FRONTEND_ORIGIN` | 요청을 허용할 프론트엔드 주소. 여러 개면 쉼표, 끝에 `/` 없이 |

처음 배포한 뒤 관리자 계정으로 로그인해 **가상 데이터 다시 채우기**를 누르거나, 아래 점검 스크립트를 한 번 돌리면 가상 데이터가 들어갑니다.

## 내 컴퓨터에서 실행

```bash
npm install
cp .env.example .env    # 값 채우기 (DATABASE_URL 은 External 주소 + ?schema=level3&sslmode=verify-full)
npx prisma migrate deploy
npm run seed            # 가상 데이터
npm run start:dev       # http://localhost:4100
```

## 규칙 자동 점검

화면을 거치지 않고 서버에 직접 요청을 보내 규칙, 역할 권한, 입력값 확인, 신청 → 승인 → 입금 → 취소 → 환불 흐름, AI 호출을 확인합니다. (시작과 끝에 가상 데이터를 다시 채웁니다)

```bash
npm run check-rules                                                        # 로컬
API_URL=https://popo-fleamarket-level3-backend.onrender.com npm run check-rules   # 배포 서버
```

최근 결과: [배포 서버 47/47 통과](docs/check-rules-deployed.md) · [로컬 47/47 통과](docs/check-rules-local.md)
