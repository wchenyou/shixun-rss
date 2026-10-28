"""Durable per-host admission budget. Unknown usage retains its reservation."""
import json
import re
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo

DEFAULTS={'daily_budget':60000,'daily_calls':4,'batch_articles':20,'body_chars':1200,'include_terms':'','exclude_terms':''}

class BudgetStop(RuntimeError):
    def __init__(self,message,retry):super().__init__(message);self.retry=retry

def codex_usage(stdout):
    found=[]
    for line in stdout.splitlines():
        try:e=json.loads(line)
        except (ValueError,TypeError):continue
        u=e.get('usage') if isinstance(e,dict) and e.get('type')=='turn.completed' else None
        if isinstance(u,dict) and all(type(u.get(k)) is int and u[k]>=0 for k in ('input_tokens','output_tokens')):found.append(u)
    return sum(u['input_tokens']+u['output_tokens'] for u in found) if found else None

def claude_usage(result):
    u=result.get('usage',{})
    keys=('input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens')
    if all(type(u.get(k)) is int and u[k]>=0 for k in ('input_tokens','output_tokens')):
        return sum(u.get(k,0) for k in keys if type(u.get(k,0)) is int)
    model=result.get('modelUsage',{})
    if not model:return None
    if not all(type(u.get('inputTokens')) is int and type(u.get('outputTokens')) is int for u in model.values()):return None
    return sum(u.get(k,0) for u in model.values() for k in ('inputTokens','outputTokens','cacheReadInputTokens','cacheCreationInputTokens') if type(u.get(k,0)) is int)

class Budget:
    def __init__(self,store,settings,clock):
        self.store=store;self.cfg={**DEFAULTS,**settings};self.clock=clock
        # A stopped process has no reliable usage report; keep its estimate.
        rows=store.get('ai_usage',[])
        for r in rows:
            if r['status']=='running':r['status']='interrupted'
        store.set('ai_usage',rows)
    def day(self):return str(datetime.fromtimestamp(self.clock(),ZoneInfo('Asia/Taipei')).date())
    def tomorrow(self):
        at=datetime.fromtimestamp(self.clock(),ZoneInfo('Asia/Taipei'))
        return (at+timedelta(days=1)).replace(hour=0,minute=0,second=1,microsecond=0).timestamp()
    def rows(self):return [r for r in self.store.get('ai_usage',[]) if r['day']==self.day()]
    def screen(self,articles):
        def words(k):return [v.strip().casefold() for v in re.split('[,，;；\n]',self.cfg[k]) if v.strip()]
        include=words('include_terms');exclude=words('exclude_terms');selected=[]
        for a in articles:
            text=(a['title']+' '+a['content']).casefold()
            if any(w in text for w in exclude) or (include and not any(w in text for w in include)):continue
            selected.append(a)
        return selected
    def fit_batch(self,articles,config):
        remaining=self.cfg['daily_budget']-sum(r['charged'] for r in self.rows())
        batch=articles[:self.cfg['batch_articles']]
        while batch:
            model=[{**a,'content':a['content'][:self.cfg['body_chars']]} for a in batch]
            context=compact_context(config,model)
            size=len(json.dumps([model,context],ensure_ascii=False).encode())
            if size<=24000 and size+24000<=remaining:return batch
            batch.pop()
        return []
    def reserve(self,method,args):
        rows=self.rows();used=sum(r['charged'] for r in rows)
        failures=[r for r in rows if r['status'] in ('failed','interrupted')]
        if len(failures)>=2:raise BudgetStop('今日已失敗兩次；未處理內容保留到明天。',self.tomorrow())
        if failures and self.clock()-failures[-1]['started']<3600:raise BudgetStop('上次執行未完成，先等待一小時。',failures[-1]['started']+3600)
        estimate_args=(args[0],args[1],{k:args[2].get(k,[]) for k in ('tracks','history','_source_results')}) if method=='report' else args
        estimate=len(json.dumps(estimate_args,ensure_ascii=False).encode())+16000+({'discover':7000,'analyze':8000,'report':10000}.get(method,8000))
        if len(rows)>=self.cfg['daily_calls'] or used+estimate>self.cfg['daily_budget']:
            raise BudgetStop('今日整理預算或次數不足，未處理內容保留到明天。',self.tomorrow())
        all_rows=self.store.get('ai_usage',[]);token=len(all_rows)
        all_rows.append({'day':self.day(),'started':self.clock(),'method':method,'status':'running','estimate':estimate,'charged':estimate,'reported':None})
        self.store.set('ai_usage',all_rows);return token
    def finish(self,token,usage,success):
        rows=self.store.get('ai_usage',[]);r=rows[token]
        r['status']='done' if success else 'failed'
        if type(usage) is int and usage>=0:r['reported']=usage;r['charged']=usage
        self.store.set('ai_usage',rows)
    def summary(self):
        rows=self.rows();pending=self.store.pending(limit=100000);eligible=self.screen(pending)
        return {'day':self.day(),'accounted_tokens':sum(r['charged'] for r in rows),'reported_tokens':sum(r['reported'] or 0 for r in rows),'unknown_runs':sum(r['reported'] is None for r in rows),'calls':len(rows),'pending':len(eligible),'filtered':len(pending)-len(eligible)}

def compact_context(config,articles):
    """Lexical retrieval is an admission heuristic, not proof of no relevance."""
    selected=[];ids=set()
    for t in config['tracks']:
        if t['status']!='active' or t.get('deleted_at'):continue
        text=(t['title']+' '+t['question']+' '+t.get('origin_excerpt','')).casefold()
        needles=set(re.findall(r'[a-z0-9][a-z0-9+-]{2,}',text))-{'the','and','what','how','for','with','this'}
        for seq in re.findall(r'[\u3400-\u9fff]{2,}',text):needles.update(seq[i:i+2] for i in range(len(seq)-1))
        matches=[a['id'] for a in articles if any(w in (a['title']+' '+a['content']).casefold() for w in needles)]
        if needles and not matches:continue
        selected.append({**{k:t[k] for k in ('id','purpose_id','status','version')},'title':t['title'][:240],'question':t['question'][:600],'origin_excerpt':t.get('origin_excerpt','')[:500]});ids.add(t['id'])
        if len(selected)==8:break
    return {**config,'purposes':[{**p,'description':p['description'][:700]} for p in config['purposes']],'tracks':selected,'track_notes':[{**n,'note':n['note'][:400]} for n in config.get('track_notes',[]) if n['track_id'] in ids],
            'history':[{k:e[k][:600] for k in ('track_id','summary','change','next_question') if k in e} for e in config.get('history',[]) if e['track_id'] in ids][:8]}
