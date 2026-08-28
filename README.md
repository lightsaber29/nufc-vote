# NUFC Fan Poll ⚫⚪

Newcastle United 팬들을 위한 실시간 투표 플랫폼. 모바일 퍼스트, 한국어.

## 기능

| 기능 | 경로 | 설명 |
|------|------|------|
| 투표 | `/polls` | 6가지 투표 타입 (`PollType` — `frontend/src/types/database.ts:3`). 제출 후 수정 불가, 결과는 참여 후 공개, 댓글은 참여자만 작성 |
| 이주의 선수 | `/players` | 주간 pick-one 집계와 평점 변동 추이 |
| 승부예측 | `/predictions` | 주차별 스코어 예측, 주간·시즌 랭킹, 결과 자동 정산 |
| 마이페이지 | `/my` | 참여 이력, 피드백 |
| 관리자 | `/admin` | 투표 생성·관리, 수집 함수 수동 트리거 |

Google 소셜 로그인(Supabase Auth)으로 참여합니다.

## 기술 스택

| 역할 | 기술 |
|------|------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (Node >= 22.6.0) |
| Styling | Tailwind CSS + shadcn/ui (Radix UI) |
| 디자인 시스템 | Storybook 10 (`src/storybook`) |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Google OAuth via Supabase Auth |
| 데이터 수집 | Supabase Edge Functions + pg_cron (FotMob) |
| Analytics | Mixpanel |
| Deploy | Vercel (root directory: `frontend/`) |

## 로컬 실행

```bash
# 의존성 설치
cd frontend
npm install

# 환경 변수 설정
cp .env.example .env.local
# .env.local 에 Supabase URL/Key 등 입력

# 개발 서버 시작 (http://localhost:3000)
npm run dev
```

> `.env.local` 없이도 실행 가능 — Supabase 미연결 시 mock 데이터로 동작 (`frontend/src/lib/config.ts`)

## 테스트 · Storybook

```bash
cd frontend
npm test          # src 아래 *.test.mjs 전부 (34개 파일) — 커밋 전에 실행
npm run lint
npm run storybook # 디자인 시스템 (http://localhost:6006)
```

## DB 스키마 배포 (Supabase CLI)

```bash
# 루트 디렉토리에서
supabase login
supabase link --project-ref <your-project-ref>
supabase db push

# 스키마 변경 후 타입 재생성
cd frontend && npm run types:supabase
```

Edge Functions 배포와 크론 설정은 `supabase/functions/README.md` 참고.

## 환경 변수

`frontend/.env.example` 참고:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_MIXPANEL_TOKEN=
```

## 프로젝트 구조

```
├── frontend/     # Next.js 앱 (Vercel root directory)
│   └── src/
│       ├── app/          # App Router 페이지
│       ├── components/
│       │   ├── primitives/   # 원자 컴포넌트
│       │   └── composition/  # 화면별 조합체
│       ├── lib/          # Supabase 클라이언트, queries(조회) / actions(쓰기)
│       ├── storybook/    # 디자인 시스템 스토리 · 문서
│       └── types/        # TypeScript 타입
├── supabase/
│   ├── migrations/   # DB 마이그레이션
│   └── functions/    # Edge Functions (FotMob 데이터 수집)
└── vault/        # Obsidian 볼트
    ├── 00_의사결정사항/  # Feature Brief · ADR · Decision Log · 회의록
    ├── 10_sup/           # 작업 노트
    └── 99_old/           # 스펙 · 유지보수 가이드
```
