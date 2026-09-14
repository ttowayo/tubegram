-- tubegram schema. Supabase SQL Editor 에 붙여넣고 실행하세요.

create table if not exists chats (
  chat_id     bigint primary key,
  name        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists channels (
  id                      bigserial primary key,
  channel_id              text not null unique,
  title                   text not null,
  handle                  text,
  thumbnail_url           text,
  uploads_playlist_id     text,
  baseline_published_at   timestamptz not null default now(),
  last_checked_at         timestamptz,
  websub_lease_expires_at timestamptz,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now()
);

create table if not exists subscriptions (
  chat_id     bigint not null references chats(chat_id) on delete cascade,
  channel_id  text   not null references channels(channel_id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (chat_id, channel_id)
);

create table if not exists videos (
  id                    bigserial primary key,
  youtube_id            text not null unique,
  channel_id            text,
  channel_title         text,
  source                text not null check (source in ('channel', 'manual')),
  title                 text,
  thumbnail_url         text,
  published_at          timestamptz,
  duration_sec          integer,
  status                text not null default 'pending'
                        check (status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  locked_at             timestamptz,
  attempts              integer not null default 0,
  error                 text,
  requested_by_chat_id  bigint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists videos_status_idx on videos (status, created_at);
create index if not exists videos_channel_idx on videos (channel_id, published_at desc);

create table if not exists summaries (
  id            bigserial primary key,
  video_id      bigint not null unique references videos(id) on delete cascade,
  summary_md    text not null,
  content       jsonb not null,
  model         text,
  summary_date  date not null,
  created_at    timestamptz not null default now()
);
create index if not exists summaries_date_idx on summaries (summary_date desc);

create table if not exists deliveries (
  video_id             bigint not null references videos(id) on delete cascade,
  chat_id              bigint not null,
  telegram_message_id  bigint,
  sent_at              timestamptz not null default now(),
  primary key (video_id, chat_id)
);

create table if not exists usage_daily (
  day            date primary key,
  video_seconds  integer not null default 0,
  requests       integer not null default 0
);

-- 서버는 service_role 키로만 접근하므로 anon 접근은 RLS 로 차단
alter table chats         enable row level security;
alter table channels      enable row level security;
alter table subscriptions enable row level security;
alter table videos        enable row level security;
alter table summaries     enable row level security;
alter table deliveries    enable row level security;
alter table usage_daily   enable row level security;

-- 일일 사용량 증가 (원자적)
create or replace function add_usage(p_day date, p_seconds integer)
returns void language sql as $$
  insert into usage_daily (day, video_seconds, requests)
  values (p_day, p_seconds, 1)
  on conflict (day) do update
    set video_seconds = usage_daily.video_seconds + excluded.video_seconds,
        requests      = usage_daily.requests + 1;
$$;
