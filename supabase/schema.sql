create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled project',
  brief text not null default '',
  second_director jsonb,
  screenwriter jsonb,
  ai_provider text not null default 'anthropic' check (ai_provider in ('anthropic', 'openai')),
  stage text not null default 'crew' check (stage in ('crew', 'dialogue', 'summary', 'production')),
  project_document jsonb,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  speaker text,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notebook_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author text not null,
  title text not null,
  detail text not null,
  accepted boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null default 'carabasai-media',
  path text not null unique,
  kind text not null,
  original_name text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;
alter table public.messages enable row level security;
alter table public.notebook_items enable row level security;
alter table public.media_assets enable row level security;

create policy "users own projects" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own messages" on public.messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own notebook" on public.notebook_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own media metadata" on public.media_assets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('carabasai-media', 'carabasai-media', false, 524288000, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm','application/pdf','text/plain','text/markdown'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "users upload own media" on storage.objects for insert to authenticated with check (bucket_id = 'carabasai-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users read own media" on storage.objects for select to authenticated using (bucket_id = 'carabasai-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own media" on storage.objects for update to authenticated using (bucket_id = 'carabasai-media' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'carabasai-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own media" on storage.objects for delete to authenticated using (bucket_id = 'carabasai-media' and (storage.foldername(name))[1] = auth.uid()::text);
