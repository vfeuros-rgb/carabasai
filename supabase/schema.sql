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

-- Large project modules live independently so a costume update does not
-- rewrite the screenplay, chat and every other generated asset.
create table if not exists public.project_sections (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  section text not null check (section in ('brief','dialogue','screenplay','casting','costumes','locations','cinematography','storyboard','videos','settings')),
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (project_id, section)
);

-- Long-running AI work is server-owned and resumable after refresh/deploy.
create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_sections_user_updated_idx on public.project_sections(user_id, updated_at desc);
create index if not exists generation_jobs_project_created_idx on public.generation_jobs(project_id, created_at desc);
create index if not exists media_assets_project_created_idx on public.media_assets(project_id, created_at desc);

alter table public.projects enable row level security;
alter table public.messages enable row level security;
alter table public.notebook_items enable row level security;
alter table public.media_assets enable row level security;
alter table public.project_sections enable row level security;
alter table public.generation_jobs enable row level security;

create policy "users own projects" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own messages" on public.messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own notebook" on public.notebook_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own media metadata" on public.media_assets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own project sections" on public.project_sections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own generation jobs" on public.generation_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('carabasai-media', 'carabasai-media', false, 524288000, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm','application/pdf','text/plain','text/markdown'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "users upload own media" on storage.objects for insert to authenticated with check (bucket_id = 'carabasai-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users read own media" on storage.objects for select to authenticated using (bucket_id = 'carabasai-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own media" on storage.objects for update to authenticated using (bucket_id = 'carabasai-media' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'carabasai-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own media" on storage.objects for delete to authenticated using (bucket_id = 'carabasai-media' and (storage.foldername(name))[1] = auth.uid()::text);
