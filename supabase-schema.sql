-- Run this in Supabase SQL Editor (free project)
create table if not exists availability (
  station_id text,
  fuel text,
  status text,
  updated_at timestamptz default now(),
  primary key (station_id, fuel)
);
create table if not exists wait_reports (
  id bigint generated always as identity primary key,
  station_id text,
  level text,
  created_at timestamptz default now()
);
-- allow public read/write for MVP (lock down later with auth)
alter table availability enable row level security;
alter table wait_reports enable row level security;
drop policy if exists "public all" on availability;
drop policy if exists "public all" on wait_reports;
create policy "public all" on availability for all using (true) with check (true);
create policy "public all" on wait_reports for all using (true) with check (true);
-- realtime
alter publication supabase_realtime add table availability;
alter publication supabase_realtime add table wait_reports;