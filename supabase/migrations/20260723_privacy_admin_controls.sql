create table if not exists public.admin_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_accounts enable row level security;

drop policy if exists "admins read own admin account" on public.admin_accounts;
create policy "admins read own admin account"
on public.admin_accounts for select to authenticated
using (user_id = auth.uid());

insert into public.admin_accounts (user_id)
select id from auth.users where lower(email) = 'vfeuros@gmail.com'
on conflict (user_id) do nothing;

create or replace function public.is_carabasai_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_accounts where user_id = auth.uid()
  );
$$;

revoke all on function public.is_carabasai_admin() from public;
grant execute on function public.is_carabasai_admin() to authenticated;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
on public.admin_audit_logs(created_at desc);

alter table public.admin_audit_logs enable row level security;

drop policy if exists "admins read audit logs" on public.admin_audit_logs;
create policy "admins read audit logs"
on public.admin_audit_logs for select to authenticated
using (public.is_carabasai_admin());

create or replace function public.record_admin_audit(
  p_action text,
  p_target_user_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.is_carabasai_admin() then
    raise exception 'administrator access required';
  end if;
  insert into public.admin_audit_logs (admin_user_id, action, target_user_id, details)
  values (auth.uid(), left(p_action, 120), p_target_user_id, coalesce(p_details, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.record_admin_audit(text, uuid, jsonb) from public;
grant execute on function public.record_admin_audit(text, uuid, jsonb) to authenticated;

create or replace function public.admin_user_directory()
returns table (
  user_id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  project_count bigint,
  media_bytes bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_carabasai_admin() then
    raise exception 'administrator access required';
  end if;
  return query
  select
    u.id,
    coalesce(u.email, '')::text,
    coalesce(l.full_name, '')::text,
    u.created_at,
    u.email_confirmed_at,
    u.last_sign_in_at,
    (select count(*) from public.projects p where p.user_id = u.id),
    (select coalesce(sum(m.size_bytes), 0)::bigint from public.media_assets m where m.user_id = u.id)
  from auth.users u
  left join public.account_leads l on l.user_id = u.id
  order by u.created_at desc;
end;
$$;

revoke all on function public.admin_user_directory() from public;
grant execute on function public.admin_user_directory() to authenticated;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

create or replace function public.prune_admin_audit_logs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed bigint;
begin
  if not public.is_carabasai_admin() then
    raise exception 'administrator access required';
  end if;
  delete from public.admin_audit_logs where created_at < now() - interval '180 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_admin_audit_logs() from public;
grant execute on function public.prune_admin_audit_logs() to authenticated;
