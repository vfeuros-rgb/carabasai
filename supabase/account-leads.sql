create table if not exists public.account_leads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  terms_accepted_at timestamptz,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_leads enable row level security;

drop policy if exists "users read own lead profile" on public.account_leads;
create policy "users read own lead profile"
on public.account_leads for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.sync_account_lead()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.account_leads (
    user_id, email, full_name, terms_accepted_at, email_confirmed_at, updated_at
  ) values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'terms_accepted_at', '')::timestamptz,
    new.email_confirmed_at,
    now()
  )
  on conflict (user_id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    terms_accepted_at = excluded.terms_accepted_at,
    email_confirmed_at = excluded.email_confirmed_at,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_account_lead_from_auth on auth.users;
create trigger sync_account_lead_from_auth
after insert or update of email, email_confirmed_at, raw_user_meta_data on auth.users
for each row execute procedure public.sync_account_lead();

insert into public.account_leads (
  user_id, email, full_name, terms_accepted_at, email_confirmed_at, created_at, updated_at
)
select
  id,
  coalesce(email, ''),
  coalesce(raw_user_meta_data ->> 'full_name', ''),
  nullif(raw_user_meta_data ->> 'terms_accepted_at', '')::timestamptz,
  email_confirmed_at,
  created_at,
  now()
from auth.users
on conflict (user_id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  terms_accepted_at = excluded.terms_accepted_at,
  email_confirmed_at = excluded.email_confirmed_at,
  updated_at = now();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users upload own avatars" on storage.objects;
drop policy if exists "users update own avatars" on storage.objects;
drop policy if exists "users delete own avatars" on storage.objects;
create policy "users upload own avatars" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own avatars" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own avatars" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
