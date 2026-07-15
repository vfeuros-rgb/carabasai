create table if not exists public.ai_usage_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_kind text not null check (bucket_kind in ('minute', 'day')),
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket_kind, bucket_start)
);

alter table public.ai_usage_buckets enable row level security;

drop policy if exists "users read own ai usage" on public.ai_usage_buckets;
create policy "users read own ai usage"
on public.ai_usage_buckets for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.consume_ai_request(p_action text default 'creative-room')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_minute_start timestamptz := date_trunc('minute', v_now);
  v_day_start timestamptz := date_trunc('day', v_now at time zone 'utc') at time zone 'utc';
  v_minute_limit integer := 8;
  v_daily_limit integer := 40;
  v_minute_count integer;
  v_daily_count integer;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if p_action not in ('creative-room', 'project-document') then
    raise exception 'INVALID_AI_ACTION' using errcode = '22023';
  end if;

  insert into public.ai_usage_buckets (user_id, bucket_kind, bucket_start, request_count)
  values (v_user_id, 'minute', v_minute_start, 0)
  on conflict do nothing;
  insert into public.ai_usage_buckets (user_id, bucket_kind, bucket_start, request_count)
  values (v_user_id, 'day', v_day_start, 0)
  on conflict do nothing;

  select request_count into v_minute_count
  from public.ai_usage_buckets
  where user_id = v_user_id and bucket_kind = 'minute' and bucket_start = v_minute_start
  for update;
  select request_count into v_daily_count
  from public.ai_usage_buckets
  where user_id = v_user_id and bucket_kind = 'day' and bucket_start = v_day_start
  for update;

  if v_minute_count >= v_minute_limit or v_daily_count >= v_daily_limit then
    return jsonb_build_object(
      'allowed', false,
      'minute_remaining', greatest(0, v_minute_limit - v_minute_count),
      'daily_remaining', greatest(0, v_daily_limit - v_daily_count),
      'retry_after_seconds', case when v_daily_count >= v_daily_limit
        then greatest(1, extract(epoch from ((v_day_start + interval '1 day') - v_now))::integer)
        else greatest(1, 60 - extract(second from v_now)::integer)
      end
    );
  end if;

  update public.ai_usage_buckets
  set request_count = request_count + 1, updated_at = v_now
  where user_id = v_user_id and bucket_kind = 'minute' and bucket_start = v_minute_start
  returning request_count into v_minute_count;
  update public.ai_usage_buckets
  set request_count = request_count + 1, updated_at = v_now
  where user_id = v_user_id and bucket_kind = 'day' and bucket_start = v_day_start
  returning request_count into v_daily_count;

  delete from public.ai_usage_buckets where bucket_start < v_day_start - interval '7 days';

  return jsonb_build_object(
    'allowed', true,
    'minute_remaining', greatest(0, v_minute_limit - v_minute_count),
    'daily_remaining', greatest(0, v_daily_limit - v_daily_count),
    'retry_after_seconds', 0
  );
end;
$$;

revoke all on function public.consume_ai_request(text) from public;
grant execute on function public.consume_ai_request(text) to authenticated;

