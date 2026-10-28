-- A single unnamed json parameter bypasses PostgREST json_to_record,
-- allowing sanitization before any recursive conversion to text/jsonb.
drop function public.publish_batch(json);
create or replace function public.publish_batch(json) returns uuid
language plpgsql security invoker set search_path='' as $$
declare
 p jsonb := public.json_without_nuls($1);
 owner uuid;
 rid uuid;
 item jsonb; tid uuid; valid boolean; snap jsonb;
begin
 if p ? 'payload' then p:=p->'payload'; end if;
 owner:=(p->>'owner_id')::uuid;
 rid:=(p->'run'->>'id')::uuid;
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


NOTIFY pgrst, 'reload schema';
