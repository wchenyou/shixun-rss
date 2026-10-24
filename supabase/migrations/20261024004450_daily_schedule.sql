alter table public.purposes add column daily_time time(0) not null default '09:00';
alter table public.sources add column daily_time time(0) not null default '09:00';
