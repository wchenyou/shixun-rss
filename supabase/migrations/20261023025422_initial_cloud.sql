-- One admitted owner; admission is an administrator operation.
create table public.owners (id uuid primary key references auth.users(id) on delete cascade);
alter table public.owners enable row level security;
grant select on public.owners to authenticated;
create policy own_membership on public.owners for select to authenticated using(id=(select auth.uid()));

create table public.purposes (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.owners,
 name text not null check(length(name)>0), description text not null default '',
 enabled boolean not null default true, version integer not null default 1,
 unique(owner_id,id)
);
create table public.sources (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.owners,
 name text not null, url text not null check(url ~ '^https?://'), enabled boolean not null default true,
 version integer not null default 1, unique(owner_id,url), unique(owner_id,id)
);
create table public.tracks (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.owners,
 purpose_id uuid not null, title text not null, question text not null,
 status text not null default 'candidate' check(status in ('candidate','active','paused','archived')),
 version integer not null default 1, created_at timestamptz not null default now(),
 unique(owner_id,id), foreign key(owner_id,purpose_id) references public.purposes(owner_id,id)
);
create table public.runs (
 id uuid primary key, owner_id uuid not null references public.owners,
 node_id text not null, status text not null,
 started_at timestamptz not null, published_at timestamptz,
 data_cutoff timestamptz, report text not null default '', config_snapshot jsonb not null,
 source_results jsonb not null default '[]', error text,
 unique(owner_id,id)
);
create table public.articles (
 id uuid primary key, owner_id uuid not null references public.owners,
 title text not null, url text not null check(url ~ '^https?://'), source_name text not null,
 content text not null, published_at timestamptz, collected_at timestamptz not null,
 unique(owner_id,id), unique(owner_id,url)
);
create table public.analyses (
 id uuid primary key, owner_id uuid not null references public.owners,
 article_id uuid not null, run_id uuid not null,
 summary text not null, relevance text not null, purpose_ids uuid[] not null default '{}',
 unique(run_id,article_id),
 foreign key(owner_id,article_id) references public.articles(owner_id,id),
 foreign key(owner_id,run_id) references public.runs(owner_id,id)
);
create table public.evaluations (
 id uuid primary key, owner_id uuid not null references public.owners,
 track_id uuid not null, run_id uuid not null, summary text not null, change text not null,
 evidence_ids uuid[] not null, counter_evidence text not null, next_question text not null,
 applicable boolean not null default true, created_at timestamptz not null default now(),
 unique(run_id,track_id),
 foreign key(owner_id,track_id) references public.tracks(owner_id,id),
 foreign key(owner_id,run_id) references public.runs(owner_id,id)
);
create table public.article_states (
 owner_id uuid not null references public.owners, article_id uuid not null,
 saved boolean not null default false, read boolean not null default false, note text not null default '',
 primary key(owner_id,article_id), foreign key(owner_id,article_id) references public.articles(owner_id,id)
);
create table public.track_notes (
 owner_id uuid not null references public.owners, track_id uuid not null, note text not null default '',
 primary key(owner_id,track_id), foreign key(owner_id,track_id) references public.tracks(owner_id,id)
);
create table public.nodes (
 id text primary key, owner_id uuid not null references public.owners,
 last_seen timestamptz not null default now(), status text not null default 'idle',
 pending_articles integer not null default 0, pending_uploads integer not null default 0,
 next_retry_at timestamptz, last_check_at timestamptz, error text
);
create function public.bump_version() returns trigger language plpgsql set search_path='' as $$
begin new.version := old.version+1; return new; end $$;
create trigger version_purposes before update on public.purposes for each row execute function public.bump_version();
create trigger version_sources before update on public.sources for each row execute function public.bump_version();
create trigger version_tracks before update on public.tracks for each row execute function public.bump_version();
do $$
declare t text;
begin
 foreach t in array array['purposes','sources','tracks','article_states','track_notes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy owner_access on public.%I for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and exists(select 1 from public.owners where id=(select auth.uid())))',t);
 end loop;
 foreach t in array array['runs','articles','analyses','evaluations','nodes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('revoke insert,update,delete on public.%I from authenticated,anon',t);
 end loop;
end $$;
create policy owner_runs on public.runs for select to authenticated using(owner_id=(select auth.uid()) and published_at is not null);
create policy owner_articles on public.articles for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_analysis on public.analyses for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.runs where id=run_id));
create policy owner_evaluations on public.evaluations for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.runs where id=run_id));
create policy owner_nodes on public.nodes for select to authenticated using(owner_id=(select auth.uid()));
create index analyses_owner_article on public.analyses(owner_id,article_id);
create index evaluations_owner_track on public.evaluations(owner_id,track_id);
create index runs_owner_published on public.runs(owner_id,published_at desc);
create index articles_owner_time on public.articles(owner_id,collected_at desc);
create index tracks_owner_purpose on public.tracks(owner_id,purpose_id);
create index sources_owner on public.sources(owner_id);
create index purposes_owner on public.purposes(owner_id);
create index nodes_owner on public.nodes(owner_id);

-- Entire publication is one Postgres transaction; retries are idempotent.
-- Invoker privileges: only the controlled worker's service role can execute.
create function public.publish_batch(payload jsonb) returns uuid
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
revoke all on function public.publish_batch(jsonb) from public,anon,authenticated;
grant execute on function public.publish_batch(jsonb) to service_role;
grant all on all tables in schema public to service_role;
