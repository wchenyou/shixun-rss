create function public.set_article_state(p_article_id uuid,p_saved boolean default null,p_read boolean default null,p_note text default null)
returns void language sql security invoker set search_path='' as $$
 insert into public.article_states(owner_id,article_id,saved,read,note)
 values(auth.uid(),p_article_id,coalesce(p_saved,false),coalesce(p_read,false),coalesce(p_note,''))
 on conflict(owner_id,article_id) do update set
 saved=coalesce(p_saved,article_states.saved),read=coalesce(p_read,article_states.read),note=coalesce(p_note,article_states.note);
$$;
revoke all on function public.set_article_state(uuid,boolean,boolean,text) from public,anon;
grant execute on function public.set_article_state(uuid,boolean,boolean,text) to authenticated;
