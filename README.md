# tubegram

구독한 유튜브 채널에 새 영상이 올라오면 Gemini 로 한국어 요약을 만들어 텔레그램으로 보내고, 사이트에 일자별로 저장하는 서비스입니다. 유튜브 URL 을 직접 보내 요약할 수도 있습니다. 전 구간 무료 티어로 동작하도록 설계했습니다.

## 구성

| 역할 | 서비스 | 비고 |
|---|---|---|
| 웹/API | Next.js 16 + Vercel Hobby | 함수 최대 300초 |
| DB | Supabase Postgres | service_role 키로 서버에서만 접근 |
| 요약 | Gemini API (무료 티어) | 유튜브 URL 을 영상 입력으로 직접 전달 (자막 스크래핑 없음) |
| 알림 | Telegram Bot (webhook) | |
| 새 영상 감지 | YouTube RSS 폴링 + WebSub 푸시 | RSS 는 키 불필요, WebSub 는 거의 실시간 |
| 메타데이터 | YouTube Data API v3 | 채널 핸들 해석, 영상 길이/라이브 여부. 없으면 스크래핑/oEmbed 로 대체 |
| 15분 폴링 | cron-job.org (외부 무료 크론) | Vercel Hobby 크론은 하루 1회만 가능 |
| 일일 작업 | Vercel Cron | WebSub 갱신, 전일 다이제스트, DB keep-alive |

## 동작 흐름

1. 텔레그램에서 `/subscribe @채널` 을 보내면 채널을 등록하고, 등록 시점의 최신 영상 시각을 기준선으로 저장합니다. 과거 영상은 요약하지 않습니다.
2. 15분마다 `/api/poll` 이 구독 채널의 RSS 를 읽어 기준선 이후의 새 영상을 `videos` 큐에 넣습니다. WebSub 가 연결되어 있으면 업로드 직후 `/api/websub` 로 푸시가 와서 더 빨리 처리됩니다.
3. 큐를 순차 처리합니다. 쇼츠, 라이브, 최대 길이 초과 영상은 건너뜁니다. Gemini 에 유튜브 URL 을 넘겨 요약을 받고 `summaries` 에 저장합니다.
4. 그 채널을 구독한 모든 chat 에 전송하고 `deliveries` 에 기록해 중복 발송을 막습니다.
5. 봇에 유튜브 URL 을 직접 보내거나 사이트 `/register` 폼에 넣으면 같은 큐에 수동 항목으로 들어가고, 완료되면 요청자에게 보냅니다.

## 설정 순서

### 1. 키 발급

- **Telegram**: BotFather 에서 봇 생성 후 토큰. 본인 chat_id 는 봇에 아무 메시지나 보내면 봇이 알려줍니다 (허용 목록에 없을 때 chat_id 를 답장).
- **Gemini**: Google AI Studio 에서 API 키.
- **YouTube Data API v3**: Google Cloud 콘솔에서 API 사용 설정 후 키 생성. API 제한은 "YouTube Data API v3" 만 선택.
- **Supabase**: 프로젝트 생성 후 Project Settings > API 에서 URL 과 service_role 키.

### 2. DB 스키마

Supabase SQL Editor 에서 `supabase/schema.sql` 을 실행합니다.

### 3. 환경 변수

`.env.example` 을 `.env` 로 복사해 채웁니다. `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `REGISTER_TOKEN` 은 임의의 긴 문자열이면 됩니다.

### 4. 로컬 검증 (DB 없이)

```bash
npm install
npm run summarize -- https://www.youtube.com/watch?v=XXXXXXXXXXX          # 요약만 출력
npm run summarize -- https://www.youtube.com/watch?v=XXXXXXXXXXX --send   # 텔레그램 전송까지
```

이 단계에서 Gemini 유튜브 입력이 정상 동작하는지 먼저 확인하세요.

### 5. 배포 (Vercel)

1. 저장소를 Vercel 에 연결하고 `.env` 의 모든 값을 Environment Variables 에 넣습니다. `APP_URL` 은 배포 도메인 (예: `https://tubegram.vercel.app`).
2. 배포 후 텔레그램 웹훅 등록:
   ```bash
   npm run webhook          # APP_URL/api/telegram/webhook 등록 + 명령 목록 설정
   npm run webhook -- --info
   ```
3. **cron-job.org** 에서 15분 주기 작업 생성:
   - URL: `https://<APP_URL>/api/poll`
   - Header: `Authorization: Bearer <CRON_SECRET>` (또는 `?secret=<CRON_SECRET>`)
   - 응답은 즉시 202 로 오고 실제 처리는 서버에서 이어지므로 타임아웃 설정은 기본값이면 됩니다. 결과를 직접 보려면 `?sync=1` 을 붙여 호출하세요.
4. Vercel Cron 은 `vercel.json` 에 이미 정의되어 있습니다 (매일 09:05 KST). Vercel 이 `CRON_SECRET` 환경 변수를 자동으로 Bearer 로 보냅니다.

### 6. 사용

봇에서:

```
/subscribe @채널핸들      채널 구독
/unsubscribe 1            구독 해지 (/list 의 번호, @핸들, URL)
/list                     구독 목록
/latest @채널핸들         최신 영상 1편 즉시 요약
/today [@채널핸들]        구독 채널에서 오늘 올라온 영상 모두 요약
/status                   큐와 오늘 사용량
/pause /resume            채널 알림 일시정지/재개
<유튜브 URL>              바로 요약
```

사이트:

- `/` 오늘 요약, `/d/2026-09-14` 일자별
- `/c` 채널 목록, `/c/<channelId>` 채널별 이력
- `/v/<youtubeId>` 상세 (플레이어 + 타임라인 링크)
- `/register` 수동 등록 (REGISTER_TOKEN 필요)

## 한도와 필터

- `MAX_VIDEO_MINUTES` (기본 90): 이보다 긴 영상은 건너뜁니다.
- `MIN_VIDEO_SECONDS` (기본 60): 채널 자동 요약에서 이보다 짧은 영상(쇼츠)은 건너뜁니다. 직접 보낸 URL 은 적용하지 않습니다.
- `DAILY_VIDEO_MINUTES_BUDGET` (기본 420): Gemini 무료 티어의 일일 영상 입력 한도를 넘지 않도록 하루 처리량을 제한합니다. 넘으면 남은 항목은 다음 날 처리됩니다.
- Gemini 429 응답 시 해당 항목을 대기로 되돌리고 다음 폴링에서 재시도합니다.
- 처리 중 오류는 3회까지 재시도하고, 그 뒤 실패로 표시하고 요청자(없으면 오너)에게 알립니다.

## 개발

```bash
npm run dev        # http://localhost:3000
npm run typecheck
npm run build
```

로컬에서 웹훅을 받으려면 ngrok 같은 터널로 `APP_URL` 을 잡고 `npm run webhook` 을 실행합니다.
