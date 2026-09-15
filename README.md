# tubegram

구독한 유튜브 채널에 새 영상이 올라오면 Gemini 로 한국어 요약을 만들어 텔레그램으로 보내고, 사이트에 일자별로 저장하는 서비스입니다. 유튜브 URL 을 직접 보내 요약할 수도 있습니다. 전 구간 무료 티어로 동작하도록 설계했습니다.

## 구성

| 역할 | 서비스 | 비고 |
|---|---|---|
| 웹/API | Next.js 16 + Vercel Hobby | 함수 최대 300초 |
| DB | Supabase Postgres | service_role 키로 서버에서만 접근 |
| 요약 | Gemini API (무료 티어, Flash Lite) | 유튜브 URL 을 영상 입력으로 직접 전달 (자막 스크래핑 없음). 프레임 0.2fps 저해상도로 토큰 절약 |
| 알림 | Telegram Bot (webhook) | |
| 새 영상 감지 | YouTube RSS 폴링 + WebSub 푸시 | RSS 는 키 불필요, WebSub 는 거의 실시간 |
| 메타데이터 | YouTube Data API v3 | 채널 핸들 해석, 영상 길이/라이브 여부. 없으면 스크래핑/oEmbed 로 대체 |
| 15분 폴링 | cron-job.org (외부 무료 크론) | Vercel Hobby 크론은 하루 1회만 가능 |
| 일일 작업 | Vercel Cron | WebSub 갱신, 전일 다이제스트, DB keep-alive |

## 동작 흐름

1. 텔레그램에서 `/subscribe @채널` 을 보내면 채널을 등록하고, 등록 시점의 최신 영상 시각을 기준선으로 저장합니다. 과거 영상은 요약하지 않습니다.
2. 15분마다 `/api/poll` 이 구독 채널의 RSS 를 읽어 기준선 이후의 새 영상을 `videos` 큐에 넣습니다. 채널에 요약 시간대를 지정해 두었다면 그 시간(KST)에 게시된 영상만 넣습니다. WebSub 가 연결되어 있으면 업로드 직후 `/api/websub` 로 푸시가 와서 더 빨리 처리됩니다.
3. 큐를 순차 처리합니다. 쇼츠, 라이브, 최대 길이 초과 영상은 건너뜁니다. Gemini 에 유튜브 URL 을 넘겨 요약을 받고 `summaries` 에 저장합니다.
4. 그 채널을 구독한 모든 chat 에 전송하고 `deliveries` 에 기록해 중복 발송을 막습니다.
5. 봇에 유튜브 URL 을 직접 보내거나 사이트 `/register` 폼에 넣으면 같은 큐에 수동 항목으로 들어가고, 완료되면 요청자에게 보냅니다.

## 요약 시간대 필터

채널마다 "이 시간(KST)에 올라온 영상만 요약" 을 걸 수 있습니다. 하루에 여러 편 올리는 채널에서 특정 코너만 받고 싶을 때 씁니다.

- 지정: 봇에서 `/subscribe @채널 07:00-09:00`, 또는 사이트 `/c` 의 표에서 해당 채널 칸에 입력 후 저장
- 해제: `/subscribe @채널 종일`, 또는 `/c` 에서 칸을 비우고 저장
- 형식: `07:00-09:00`, `0700-0900`, `7-9`, `22:00~02:00` 모두 됩니다. 자정을 넘는 구간도 그대로 쓰면 됩니다.
- 구간은 시작 포함, 끝 제외(`[start, end)`)이고 기준은 RSS 의 게시 시각입니다.
- `/poll`, WebSub 푸시, `/today` 에 모두 적용됩니다. `/latest` 와 직접 보낸 URL 은 적용받지 않으니 필터 밖의 영상이 필요하면 그쪽을 쓰세요.

> 라이브 방송과 프리미어는 RSS 게시 시각이 실제 방송 시작과 다를 수 있습니다. 그런 채널에서는 구간을 넉넉히 잡는 편이 안전합니다.

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
/subscribe @채널 07:00-09:00   그 시간(KST)에 올라온 영상만 요약
/subscribe @채널 종일     시간대 해제
/unsubscribe 1            구독 해지 (/list 의 번호, @핸들, URL)
/list                     구독 목록 (시간대도 함께 표시)
/latest @채널핸들         최신 영상 1편 즉시 요약
/today [@채널핸들]        구독 채널에서 오늘 올라온 영상 모두 요약
/status                   큐와 오늘 사용량
/pause /resume            채널 알림 일시정지/재개
<유튜브 URL>              바로 요약
```

사이트:

- `/` 오늘 요약, `/d/2026-09-14` 일자별
- `/c` 채널 목록 (채널 추가/해지, 채널별 요약 시간대 지정), `/c/<channelId>` 채널별 이력
- `/v/<youtubeId>` 상세 (플레이어 + 타임라인 링크)
- `/today` 구독 채널의 오늘 영상 요약 실행
- `/register` 수동 등록
- `/login` 로그인

### 로그인

사이트 전체가 `REGISTER_TOKEN` 암호로 잠겨 있습니다. 로그인하지 않으면 모든 페이지가 `/login` 으로 넘어가고, 로그인하면 7일간 유지됩니다. 보려던 주소는 `?next=` 로 남겨 로그인 후 그 페이지로 돌아갑니다.

- 인증은 `src/proxy.ts`(Next 16 부터 미들웨어의 새 이름)에서 처리합니다.
- 쿠키에는 원문 토큰이 아니라 SHA-256 해시를 담습니다. 쿠키가 어딘가에 기록되어도 `REGISTER_TOKEN` 자체는 새지 않습니다.
- `/api/*` 는 proxy 대상에서 빼두었습니다. 크론·텔레그램 웹훅·WebSub 는 각자 시크릿으로 인증하고, 쓰기 API(`/api/channels`, `/api/videos`, `/api/today`)는 요청마다 `siteAuthorized` 로 따로 검사합니다.
- 헤더 오른쪽 `로그아웃` 으로 쿠키를 지웁니다.

## 한도와 필터

### Gemini 무료 등급 한도 대응

무료 등급은 모델별로 분당 요청(RPM), 분당 토큰(TPM), 일일 요청(RPD) 한도가 있습니다. 영상 입력은 기본 설정에서 초당 약 260 토큰을 쓰므로 30분 영상 하나가 TPM 250K 를 넘깁니다. 이를 피하기 위해:

- `GEMINI_VIDEO_FPS=0.2` 와 저해상도 입력으로 초당 약 40~46 토큰만 씁니다. 90분 영상도 한 요청에 들어갑니다.
- 추정 토큰이 TPM 의 80% 를 넘는 긴 영상은 구간으로 나눠 각각 정리한 뒤 하나로 합칩니다.
- 같은 실행 안에서는 모델별로 분당 토큰/요청 한도를 계산해 필요하면 다음 분까지 기다린 뒤 호출합니다.
- 한도에 걸리면 **모델 체인의 다음 모델로 넘어갑니다** (아래 참고).
- 체인의 모든 모델이 막히면 대기열로 되돌리고 다음 폴링에서 재시도하며, 3회 반복되면 실패 처리 후 알림을 보냅니다.
- 유료 등급으로 전환하면 `GEMINI_MODELS` 의 RPM/TPM 을 올리고 `GEMINI_VIDEO_FPS` 를 1 로 되돌리면 됩니다.

### 모델 폴백 체인

`GEMINI_MODELS` 에 `모델:RPM:TPM` 을 쉼표로 나열하면, 429(한도)·503(과부하)·404(사용 불가) 를 받은 모델은 잠시 쉬게 하고 다음 모델로 넘어갑니다. RPD(일일 요청) 는 API 로 미리 조회할 수 없어 429 를 받은 뒤에야 알 수 있으므로, 이 방식이 RPM·TPM·RPD 세 가지를 모두 커버합니다. 비워두면 아래 기본 체인을 씁니다.

| 순서 | 모델 | RPM | TPM | RPD |
|---|---|---|---|---|
| 1 | `gemini-3.5-flash-lite` | 15 | 250K | 500 |
| 2 | `gemini-3.1-flash-lite` | 15 | 250K | 500 |
| 3 | `gemini-3.8-flash` | 5 | 250K | 20 |
| 4 | `gemini-3.7-flash` | 5 | 250K | 20 |
| 5 | `gemini-3.6-flash` | 5 | 250K | 20 |
| 6 | `gemini-3.5-flash` | 5 | 250K | 20 |
| 7 | `gemini-3-flash-preview` | 5 | 250K | 20 |

- 분당 한도(429) 나 과부하(503) 는 응답의 `retryDelay` 만큼(최소 15초) 쉬게 합니다.
- 일일 한도(429, `PerDay`) 와 사용 불가(404) 는 그 실행 동안 해당 모델을 빼둡니다.
- 모든 모델이 쉬는 중이고 가장 빠른 해제까지 30초를 넘으면 대기열로 되돌립니다.
- `gemini-2.5-*` 는 신규 사용자에게 404 (`no longer available to new users`) 라 기본 체인에서 제외했습니다. 대시보드에는 한도가 보이지만 호출은 안 됩니다.
- 한 영상 안에서 모델이 섞일 수 있고, 실제 사용한 모델은 `summaries.model` 에 `a+b` 형태로 기록됩니다.
- `npm run check` 가 체인의 모든 모델을 순서대로 호출해 응답 여부를 확인합니다.

### 그 밖의 한도

- `MAX_VIDEO_MINUTES` (기본 90): 이보다 긴 영상은 건너뜁니다.
- `MIN_VIDEO_SECONDS` (기본 60): 채널 자동 요약에서 이보다 짧은 영상(쇼츠)은 건너뜁니다. 직접 보낸 URL 은 적용하지 않습니다.
- `DAILY_VIDEO_MINUTES_BUDGET` (기본 600): 하루에 요약할 영상 분량의 상한. 넘으면 남은 항목은 KST 자정이 지나 예산이 리셋된 뒤 처리됩니다.
  - Gemini 무료 등급에는 일일 토큰/영상 분량 한도가 없고 RPM·TPM·RPD 뿐이므로, 이 값은 API 한도가 아니라 **폭주 방어용 상한**입니다. 채널을 대량으로 추가했거나 큐에 문제가 생겼을 때 하루 처리량을 묶어둡니다.
  - 구독 채널 6개 기준 실수요가 하루 약 440분이라 600 으로 두었습니다. 채널을 늘리면 같이 올리세요. 남은 항목이 매일 다음 날로 밀린다면 이 값이 낮은 것입니다.
- Gemini 한도에 걸리면 체인의 다음 모델로 넘어가고, 모든 모델이 막히면 대기로 되돌려 다음 폴링에서 재시도합니다.
- 처리 중 오류는 3회까지 재시도하고, 그 뒤 실패로 표시하고 요청자(없으면 오너)에게 알립니다.

## 개발

```bash
npm run dev        # http://localhost:3000
npm run typecheck
npm run build
```

로컬에서 웹훅을 받으려면 ngrok 같은 터널로 `APP_URL` 을 잡고 `npm run webhook` 을 실행합니다.
