"""Local daily schedule ledger. No AI calls when nothing is due."""
from datetime import datetime
from zoneinfo import ZoneInfo

class ScopedCloud:
    def __init__(self,cloud,config):self.original=cloud;self.settings=config
    def __getattr__(self,name):return getattr(self.original,name)
    def config(self):return self.settings

class DailySchedule:
    def __init__(self,store,cloud,at=None):
        self.store=store
        current=(at or datetime.now(ZoneInfo('Asia/Taipei'))).astimezone(ZoneInfo('Asia/Taipei'))
        config=cloud.config();self.keys=[];self.key_items={};self.purpose_ids=[];self.source_ids=[]
        ledger=store.get('daily_schedule',{})
        inflight=store.get('schedule_inflight') if store.jobs() or store.counts()['pending_articles'] else None
        for kind,selected in [('purposes',self.purpose_ids),('sources',self.source_ids)]:
            for item in config[kind]:
                clock=item.get('daily_time','09:00')[:5]
                key=f"{current.date()}:{kind}:{item['id']}:{clock}"
                if item['enabled'] and ((inflight and item['id'] in inflight.get(kind,[])) or
                    (not inflight and current.strftime('%H:%M')>=clock and key not in ledger)):
                    selected.append(item['id']);self.keys.append(key);self.key_items[key]=(kind,item['id'])
        self.due=bool(self.keys)
        purposes=[p for p in config['purposes'] if p['enabled'] and (not self.purpose_ids or p['id'] in self.purpose_ids)]
        sources=[s for s in config['sources'] if s['id'] in self.source_ids]
        tracks=[t for t in config['tracks'] if any(t['purpose_id']==p['id'] for p in purposes)]
        self.cloud=ScopedCloud(cloud,{**config,'purposes':purposes,'sources':sources,'tracks':tracks})
        self.scope={'purposes':self.purpose_ids,'sources':self.source_ids}
    def preview(self):return {'timezone':'Asia/Taipei','due_directions':len(self.purpose_ids),'due_sources':len(self.source_ids)}
    def finish(self):
        status=self.store.get('status',{}).get('status')
        if status in ('complete','partial','no_new') and not self.store.jobs() and not self.store.counts()['pending_articles']:
            ledger=self.store.get('daily_schedule',{})
            day=self.keys[0].split(':')[0] if self.keys else ''
            ledger={key:value for key,value in ledger.items() if key.startswith(day+':')}
            successful={r.get('source_id') for r in self.store.get('source_results',[]) if r.get('ok')}
            ledger.update({key:True for key in self.keys if self.key_items[key][0]=='purposes' or self.key_items[key][1] in successful})
            self.store.set('daily_schedule',ledger);self.store.set('schedule_inflight',None)
        else:self.store.set('schedule_inflight',self.scope)
