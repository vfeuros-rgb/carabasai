create table if not exists public.project_sections (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  section text not null check (section in ('brief','dialogue','screenplay','casting','costumes','locations','cinematography','storyboard','videos','settings')),
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (project_id, section)
);

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

alter table public.project_sections enable row level security;
alter table public.generation_jobs enable row level security;

drop policy if exists "users own project sections" on public.project_sections;
create policy "users own project sections" on public.project_sections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users own generation jobs" on public.generation_jobs;
create policy "users own generation jobs" on public.generation_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

