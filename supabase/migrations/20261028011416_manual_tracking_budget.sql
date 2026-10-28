-- Additive cloud support for the manual-only reader. Existing public-workspace
-- access is retained; worker publication remains service_role-only.
alter table public.tracks add column if not exists manual boolean not null default false;
alter table public.tracks add column if not exists deleted_at timestamptz;
alter table public.tracks add column if not exists origin_excerpt text not null default '';
alter table public.tracks add column if not exists origin_kind text not null default 'manual';
alter table public.tracks add column if not exists origin_article_id uuid;
alter table public.tracks add column if not exists origin_report_id uuid;
alter table public.tracks add column if not exists origin_evidence_ids uuid[] not null default '{}';
alter table public.nodes add column if not exists agent_version text;
alter table public.nodes add column if not exists usage_summary jsonb;
alter table public.tracks alter column status set default 'active';

create table public.reader_settings (
 owner_id uuid primary key references public.owners(id),
 daily_budget integer not null default 60000 check(daily_budget between 10000 and 1000000),
 daily_calls integer not null default 4 check(daily_calls between 1 and 20),
 batch_articles integer not null default 20 check(batch_articles between 1 and 40),
 body_chars integer not null default 1200 check(body_chars between 300 and 2400),
 include_terms text not null default '' check(length(include_terms)<=1000),
 exclude_terms text not null default '' check(length(exclude_terms)<=1000),
 version integer not null default 1
);
alter table public.reader_settings enable row level security;
grant select,insert,update on public.reader_settings to anon,authenticated;
grant all on public.reader_settings to service_role;
create policy reader_settings_access on public.reader_settings for all to anon,authenticated
 using(owner_id=coalesce((select auth.uid()),(select owner_id from public.workspace_access where singleton)))
 with check(owner_id=coalesce((select auth.uid()),(select owner_id from public.workspace_access where singleton)));
create trigger version_reader_settings before update on public.reader_settings for each row execute function public.bump_version();
insert into public.reader_settings(owner_id) select owner_id from public.workspace_access;

-- Aaron requested clearing the old tracking list on October 27. Retain a
-- recoverable trash record, preserve articles/bookmarks and never erase newer work.
update public.tracks set deleted_at=now(),status='archived'
 where created_at < '2026-10-27T00:00:00+08' and deleted_at is null;

-- PostgREST must accept json (not jsonb) so an old worker's already-validated
-- batch containing escaped NUL can reach this sanitizer before the jsonb cast.
create function public.json_without_nuls(raw json) returns jsonb
language plpgsql immutable security invoker set search_path='' as $fn$
declare current_text text := raw::text; next_text text;
begin
 loop
  next_text := regexp_replace(current_text,$rx$(^|[^\\])((?:\\\\)*)\\u0000$rx$,'\1\2','g');
  exit when next_text=current_text;
  current_text:=next_text;
 end loop;
 return current_text::jsonb;
end $fn$;
revoke all on function public.json_without_nuls(json) from public,anon,authenticated;
grant execute on function public.json_without_nuls(json) to service_role;
drop function public.publish_batch(jsonb);

create or replace function public.publish_batch(payload json) returns uuid
language plpgsql security invoker set search_path='' as $$
declare
 p jsonb := public.json_without_nuls(payload);
 owner uuid := (p->>'owner_id')::uuid;
 rid uuid := (p->'run'->>'id')::uuid;
 item jsonb; tid uuid; valid boolean; snap jsonb;
begin
 if not exists(select 1 from public.owners where id=owner) then raise exception 'Unknown owner'; end if;
 if exists(select 1 from public.runs where id=rid and owner_id=owner and published_at is not null) then return rid; end if;
 insert into public.runs(id,owner_id,node_id,status,started_at,data_cutoff,report,config_snapshot,source_results)
 values(rid,owner,p->'run'->>'node_id',p->'run'->>'status',
 (p->'run'->>'started_at')::timestamptz,(p->'run'->>'data_cutoff')::timestamptz,
 p->'run'->>'report',p->'run'->'config_snapshot',p->'run'->'source_results');
 for item in select * from jsonb_array_elements(p->'articles') loop
  insert into public.articles(id,owner_id,title,url,source_name,content,published_at,collected_at)
  values((item->>'id')::uuid,owner,item->>'title',item->>'url',item->>'source_name',case when position('%PDF-' in left(item->>'content',160))>0 then '來源為 PDF，未取得可讀內文；請開啟原始來源。' else item->>'content' end,
   (item->>'published_at')::timestamptz,(item->>'collected_at')::timestamptz)
  on conflict(id) do nothing;
 end loop;
 for item in select * from jsonb_array_elements(p->'analyses') loop
  insert into public.analyses(id,owner_id,article_id,run_id,summary,relevance,purpose_ids)
  values((item->>'id')::uuid,owner,(item->>'article_id')::uuid,rid,item->>'summary',item->>'relevance',
   array(select jsonb_array_elements_text(item->'purpose_ids')::uuid));
 end loop;
 for item in select * from jsonb_array_elements(p->'evaluations') loop
  tid := (item->>'track_id')::uuid;
  if not exists(select 1 from public.tracks t where t.id=tid and t.owner_id=owner and t.manual and t.deleted_at is null) then continue; end if;
  select value into snap from jsonb_array_elements(p->'run'->'config_snapshot'->'tracks') where value->>'id'=tid::text;
  select (t.status='active' and (snap is null or t.version=(snap->>'version')::integer))
    into valid from public.tracks t where t.id=tid and t.owner_id=owner;
  valid := coalesce(valid,false) and exists(
    select 1 from public.tracks t join public.purposes p on p.id=t.purpose_id and p.owner_id=t.owner_id
    join jsonb_array_elements(p->'run'->'config_snapshot'->'purposes') s on s->>'id'=p.id::text
    where t.id=tid and t.owner_id=owner and p.enabled and p.version=(s->>'version')::integer
  );
  if exists(select 1 from unnest(array(select jsonb_array_elements_text(item->'evidence_ids')::uuid)) e
    where not exists(select 1 from public.articles a where a.id=e and a.owner_id=owner))
    then raise exception 'Evidence references unknown article'; end if;
  insert into public.evaluations(id,owner_id,track_id,run_id,summary,change,evidence_ids,counter_evidence,next_question,applicable)
  values((item->>'id')::uuid,owner,tid,rid,item->>'summary',item->>'change',
   array(select jsonb_array_elements_text(item->'evidence_ids')::uuid),item->>'counter_evidence',item->>'next_question',coalesce(valid,false));
 end loop;
 update public.runs set published_at=now() where id=rid and owner_id=owner;
 return rid;
end $$;


revoke all on function public.publish_batch(json) from public,anon,authenticated;
grant execute on function public.publish_batch(json) to service_role;

create function public.create_manual_track(p_id uuid,p_purpose uuid,p_title text,p_question text,
 p_excerpt text default '',p_article_id uuid default null,p_kind text default 'manual',
 p_report_id uuid default null,p_evidence_ids uuid[] default '{}') returns uuid
language plpgsql security invoker set search_path='' as $fn$
declare own uuid := coalesce(auth.uid(),(select owner_id from public.workspace_access where singleton));
 valid boolean := false; origin text;
begin
 if own is null or not exists(select 1 from public.purposes where id=p_purpose and owner_id=own) then raise exception 'Invalid research direction'; end if;
 if length(btrim(p_title)) not between 1 and 240 or length(btrim(p_question)) not between 1 and 3000 or length(p_excerpt)>2000 then raise exception 'Invalid topic, question or excerpt length'; end if;
 if p_kind='manual' then valid:=p_excerpt='' and p_article_id is null and p_report_id is null;
 elsif p_kind in ('article_title','article_body','ai_summary') and p_article_id is not null and p_excerpt<>'' then
  if p_kind='article_title' then select title into origin from public.articles where id=p_article_id and owner_id=own;
  elsif p_kind='article_body' then select content into origin from public.articles where id=p_article_id and owner_id=own;
  else select string_agg(summary||E'\n'||relevance,E'\n') into origin from public.analyses where article_id=p_article_id and owner_id=own;
  end if;
  valid:=position(p_excerpt in coalesce(origin,''))>0;
 elsif p_kind='report' and p_report_id is not null and p_excerpt<>'' then
  select string_agg(v#>>'{}',E'\n') into origin from public.runs r,
    lateral jsonb_path_query(r.config_snapshot,'$.purpose_reports.** ? (@.type() == "string")') v
    where r.id=p_report_id and r.owner_id=own and r.published_at is not null;
  valid:=position(p_excerpt in coalesce(origin,''))>0;
 end if;
 if not coalesce(valid,false) then raise exception 'Selected text does not match the supplied source'; end if;
 if exists(select 1 from unnest(p_evidence_ids) e where not exists(select 1 from public.articles a where a.id=e and a.owner_id=own)) then raise exception 'Invalid source evidence'; end if;
 insert into public.tracks(id,owner_id,purpose_id,title,question,status,manual,origin_excerpt,origin_kind,origin_article_id,origin_report_id,origin_evidence_ids)
 values(p_id,own,p_purpose,btrim(p_title),btrim(p_question),'active',true,p_excerpt,p_kind,p_article_id,p_report_id,p_evidence_ids);
 return p_id;
end $fn$;
create function public.delete_manual_tracks(p_ids uuid[]) returns integer
language plpgsql security invoker set search_path='' as $fn$
declare n integer;
begin
 update public.tracks set deleted_at=now(),status='archived' where id=any(p_ids) and deleted_at is null;
 get diagnostics n=row_count; return n;
end $fn$;
create function public.restore_manual_track(p_id uuid) returns void
language sql security invoker set search_path='' as $fn$
 update public.tracks set deleted_at=null,manual=true,status='active' where id=p_id and deleted_at is not null;
$fn$;
revoke all on function public.create_manual_track(uuid,uuid,text,text,text,uuid,text,uuid,uuid[]) from public;
revoke all on function public.delete_manual_tracks(uuid[]) from public;
revoke all on function public.restore_manual_track(uuid) from public;
grant execute on function public.create_manual_track(uuid,uuid,text,text,text,uuid,text,uuid,uuid[]),public.delete_manual_tracks(uuid[]),public.restore_manual_track(uuid) to anon,authenticated,service_role;
