import json
from urllib.request import Request, urlopen
from urllib.parse import urlencode
def clean_transport(value):
    if isinstance(value,str):return value.replace('\x00','')
    if isinstance(value,list):return [clean_transport(v) for v in value]
    if isinstance(value,dict):return {k:clean_transport(v) for k,v in value.items()}
    return value

class Cloud:
    def __init__(self,url,key,owner,node):
        self.url=url.rstrip('/');self.key=key;self.owner=owner;self.node=node
    def request(self,path,body=None,method=None,prefer=None):
        headers={'apikey':self.key,'Content-Type':'application/json'}
        if self.key.startswith('eyJ'): headers['Authorization']='Bearer '+self.key
        if prefer: headers['Prefer']=prefer
        req=Request(self.url+'/rest/v1/'+path,data=json.dumps(clean_transport(body)).encode() if body is not None else None,headers=headers,method=method)
        with urlopen(req,timeout=40) as r:
            raw=r.read()
            return json.loads(raw) if raw else None
    def rows(self,table,extra=None):
        result=[]
        for offset in range(0,1_000_000,1000):
            query={'owner_id':'eq.'+self.owner,'select':'*','limit':1000,'offset':offset,'order':'id'}
            if table=='track_notes':query['order']='track_id'
            if extra:query.update(extra)
            batch=self.request(table+'?'+urlencode(query))
            result.extend(batch)
            if len(batch)<1000:return result
        raise RuntimeError('Dataset exceeds worker pagination limit')
    def config(self):
        result={t:self.rows(t) for t in ('purposes','sources','tracks','track_notes','reader_settings')}
        result['tracks']=[t for t in result['tracks'] if t.get('manual') and not t.get('deleted_at')]
        return result
    def history(self):
        return self.rows('evaluations',{'order':'created_at.desc','limit':1000})[:1000]
    def publish(self,payload):
        return self.request('rpc/publish_batch',{'payload':payload})
    def heartbeat(self,fields):
        return self.request('nodes?on_conflict=id',{'id':self.node,'owner_id':self.owner,**fields},prefer='resolution=merge-duplicates')
