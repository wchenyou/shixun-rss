create or replace function public.publish_batch(payload jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare
 owner uuid := (payload->>'owner_id')::uuid;
 rid uuid := (payload->'run'->>'id')::uuid;
 item jsonb; tid uuid; valid boolean; snap jsonb;
begin
 if not exists(select 1 from public.owners where id=owner) then raise exception 'Unknown owner'; end if;
 if exists(select 1 from public.runs where id=rid and owner_id=owner and published_at is not null) then return rid; end if;
 insert into public.runs(id,owner_id,node_id,status,started_at,data_cutoff,report,config_snapshot,source_results)
 values(rid,owner,payload->'run'->>'node_id',payload->'run'->>'status',
 (payload->'run'->>'started_at')::timestamptz,(payload->'run'->>'data_cutoff')::timestamptz,
 payload->'run'->>'report',payload->'run'->'config_snapshot',payload->'run'->'source_results');
 for item in select * from jsonb_array_elements(payload->'articles') loop
  insert into public.articles(id,owner_id,title,url,source_name,content,published_at,collected_at)
  values((item->>'id')::uuid,owner,item->>'title',item->>'url',item->>'source_name',item->>'content',
   (item->>'published_at')::timestamptz,(item->>'collected_at')::timestamptz)
  on conflict(id) do nothing;
 end loop;
 for item in select * from jsonb_array_elements(payload->'analyses') loop
  insert into public.analyses(id,owner_id,article_id,run_id,summary,relevance,purpose_ids)
  values((item->>'id')::uuid,owner,(item->>'article_id')::uuid,rid,item->>'summary',item->>'relevance',
   array(select jsonb_array_elements_text(item->'purpose_ids')::uuid));
 end loop;
 for item in select * from jsonb_array_elements(payload->'candidates') loop
  insert into public.tracks(id,owner_id,purpose_id,title,question,status)
  values((item->>'id')::uuid,owner,(item->>'purpose_id')::uuid,item->>'title',item->>'question','candidate')
  on conflict(id) do nothing;
 end loop;
 for item in select * from jsonb_array_elements(payload->'evaluations') loop
  tid := (item->>'track_id')::uuid;
  select value into snap from jsonb_array_elements(payload->'run'->'config_snapshot'->'tracks') where value->>'id'=tid::text;
  select (t.status in ('active','candidate') and (snap is null or t.version=(snap->>'version')::integer))
    into valid from public.tracks t where t.id=tid and t.owner_id=owner;
  valid := coalesce(valid,false) and exists(
    select 1 from public.tracks t join public.purposes p on p.id=t.purpose_id and p.owner_id=t.owner_id
    join jsonb_array_elements(payload->'run'->'config_snapshot'->'purposes') s on s->>'id'=p.id::text
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
