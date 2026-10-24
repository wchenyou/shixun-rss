-- Explicit single-workspace public access, requested by the owner.
-- Admin selects the public owner out-of-band; browsers cannot change it.
create table public.workspace_access (
 singleton boolean primary key default true check(singleton),
 owner_id uuid not null references public.owners(id)
);
alter table public.workspace_access enable row level security;
revoke all on public.workspace_access from anon,authenticated;
grant select on public.workspace_access to anon,authenticated;
grant all on public.workspace_access to service_role;
create policy read_workspace on public.workspace_access for select to anon,authenticated using(true);

do $$
declare t text;
begin
 foreach t in array array['purposes','sources','tracks','article_states','track_notes'] loop
  execute format('grant select,insert,update,delete on public.%I to anon',t);
  execute format('create policy public_workspace_access on public.%I for all to anon using(owner_id=(select owner_id from public.workspace_access where singleton)) with check(owner_id=(select owner_id from public.workspace_access where singleton))',t);
 end loop;
 foreach t in array array['articles','nodes'] loop
  execute format('grant select on public.%I to anon',t);
  execute format('create policy public_workspace_read on public.%I for select to anon using(owner_id=(select owner_id from public.workspace_access where singleton))',t);
 end loop;
end $$;
grant select on public.runs,public.analyses,public.evaluations to anon;
create policy public_workspace_runs on public.runs for select to anon using(
 owner_id=(select owner_id from public.workspace_access where singleton) and published_at is not null);
create policy public_workspace_analyses on public.analyses for select to anon using(
 owner_id=(select owner_id from public.workspace_access where singleton) and exists(select 1 from public.runs r where r.id=run_id));
create policy public_workspace_evaluations on public.evaluations for select to anon using(
 owner_id=(select owner_id from public.workspace_access where singleton) and exists(select 1 from public.runs r where r.id=run_id));

create or replace function public.set_article_state(p_article_id uuid,p_saved boolean default null,p_read boolean default null,p_note text default null)
returns void language sql security invoker set search_path='' as $$
 insert into public.article_states(owner_id,article_id,saved,read,note)
 values(coalesce(auth.uid(),(select owner_id from public.workspace_access where singleton)),p_article_id,coalesce(p_saved,false),coalesce(p_read,false),coalesce(p_note,''))
 on conflict(owner_id,article_id) do update set
 saved=coalesce(p_saved,article_states.saved),read=coalesce(p_read,article_states.read),note=coalesce(p_note,article_states.note);
$$;
revoke all on function public.set_article_state(uuid,boolean,boolean,text) from public;
grant execute on function public.set_article_state(uuid,boolean,boolean,text) to anon,authenticated;
