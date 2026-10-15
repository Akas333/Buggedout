-- Dueline (semester planner): one saved plan per signed-in user, synced from the browser by js/sync.js.
-- Applied as migration "dueline_plans" to Supabase project cvqzcpehxiapkkamhsbm, which Dueline shares with
-- the Hudjee app. Nothing in Hudjee reads or writes this table.
create table public.dueline_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint dueline_plans_state_size check (octet_length(state::text) <= 2000000)
);
comment on table public.dueline_plans is 'Dueline semester planner: the whole planner state per user. version goes up by one on every update so clients can detect writes from another device.';

alter table public.dueline_plans enable row level security;

create policy "Dueline: read own plan" on public.dueline_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Dueline: create own plan" on public.dueline_plans
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Dueline: update own plan" on public.dueline_plans
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Dueline: delete own plan" on public.dueline_plans
  for delete to authenticated using ((select auth.uid()) = user_id);

create function public.dueline_plans_bump() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger dueline_plans_bump
  before update on public.dueline_plans
  for each row execute function public.dueline_plans_bump();

revoke all on public.dueline_plans from anon;
grant select, insert, update, delete on public.dueline_plans to authenticated;
revoke execute on function public.dueline_plans_bump() from public, anon, authenticated;
