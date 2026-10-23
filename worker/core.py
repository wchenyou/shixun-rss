"""Pure data validation, RSS parsing and quota policy. No model calls."""
import hashlib
import ipaddress
import json
import re
import socket
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler

def now():
    return datetime.now(timezone.utc).isoformat()

def stable_id(*parts):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, '|'.join(map(str, parts))))

def canonical_url(url):
    p = urlsplit(url.strip())
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('Only public HTTP(S) URLs are supported')
    query = [(k,v) for k,v in parse_qsl(p.query, keep_blank_values=True) if not k.lower().startswith('utm_') and k.lower() not in ('fbclid','gclid')]
    return urlunsplit((p.scheme.lower(),p.netloc.lower(),p.path or '/',urlencode(sorted(query)),''))

def public_url(url):
    url = canonical_url(url)
    p = urlsplit(url)
    for info in socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme=='https' else 80)):
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise ValueError('Private/local network RSS URLs are not allowed')
    return url

class PublicRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def fetch_feed(url):
    req=Request(public_url(url), headers={'User-Agent':'ShixunRSS/0.1 (+personal RSS reader)'})
    with build_opener(PublicRedirect()).open(req, timeout=25) as response:
        raw=response.read(4_000_001)
    if len(raw)>4_000_000:
        raise ValueError('RSS exceeds 4 MB limit')
    return raw

def clean(text):
    return re.sub(r'\s+',' ',unescape(re.sub('<[^>]+>',' ',text or ''))).strip()

def parse_feed(raw, source, owner):
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('XML entities are not supported')
    root=ET.fromstring(raw)
    items=root.findall('.//item') or root.findall('{http://www.w3.org/2005/Atom}entry')
    articles=[]
    for item in items:
        def field(*names):
            for name in names:
                e=item.find(name)
                if e is not None and e.text:
                    return e.text.strip()
            return ''
        atom='{http://www.w3.org/2005/Atom}'
        link=field('link')
        if not link:
            links=item.findall(atom+'link')
            link=next((e.attrib.get('href','') for e in links if e.attrib.get('rel','alternate')=='alternate'),'')
        try: url=canonical_url(link)
        except ValueError: continue
        date=field('pubDate',atom+'published',atom+'updated')
        try:
            dt=parsedate_to_datetime(date) if ',' in date else datetime.fromisoformat(date.replace('Z','+00:00'))
            if dt.tzinfo is None: dt=dt.replace(tzinfo=timezone.utc)
            published=dt.isoformat()
        except (ValueError,TypeError): published=None
        content=clean(field('{http://purl.org/rss/1.0/modules/content/}encoded','description',atom+'content',atom+'summary'))
        articles.append(dict(id=stable_id(owner,url),title=clean(field('title',atom+'title')) or url,url=url,source_name=source['name'],content=content[:20000],published_at=published,collected_at=now()))
    return articles

def config_hash(config):
    # Include notes and all versions, never rely on a model to invent versions.
    return hashlib.sha256(json.dumps(config,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def quota_state(result, bucket_ids=('codex',), attempt=0, timestamp=None):
    import time
    timestamp=timestamp or time.time()
    buckets=result.get('rateLimitsByLimitId') or {}
    if not buckets and result.get('rateLimits'):
        r=result['rateLimits'];buckets={r.get('limitId') or 'codex':r}
    selected=[buckets[k] for k in bucket_ids if k in buckets]
    if len(selected)!=len(bucket_ids):
        return {'status':'quota_unknown','next_retry_at':timestamp+min(900*2**min(attempt,2),3600),'reason':'Relevant quota bucket unavailable'}
    blocked=[];missing=False
    for bucket in selected:
        kind=bucket.get('rateLimitReachedType')
        if kind and kind not in ('rateLimit','rate_limit','usageLimit','usage_limit'):
            return {'status':'needs_attention','next_retry_at':None,'reason':'Limit requires manual review: '+str(kind)}
        for window in ('primary','secondary'):
            w=bucket.get(window)
            if w and w.get('usedPercent') is not None and w['usedPercent']>=100:
                reset=w.get('resetsAt')
                if isinstance(reset,(int,float)) and reset>timestamp: blocked.append(reset+30)
                else: missing=True
        if kind and not blocked: missing=True
    delay=timestamp+min(900*2**min(attempt,2),3600)
    if blocked or missing:
        return {'status':'waiting_quota','next_retry_at':max(blocked+[delay] if missing else blocked),'reason':'Account quota exhausted'}
    if not any(b.get('primary',{}).get('usedPercent') is not None for b in selected if b.get('primary')):
        return {'status':'quota_unknown','next_retry_at':delay,'reason':'Quota values unavailable'}
    return {'status':'available','next_retry_at':None,'reason':None}

def validate_result(result, articles, config):
    ids={a['id'] for a in articles}
    purposes={p['id'] for p in config['purposes'] if p['enabled']}
    tracks={t['id'] for t in config['tracks'] if t['status']=='active'}
    if not isinstance(result,dict) or set(result)!= {'report','analyses','candidates','evaluations'}:
        raise ValueError('Invalid result fields')
    if not isinstance(result['report'],str): raise ValueError('Report must be text')
    rows=result['analyses']
    if {a['article_id'] for a in rows}!=ids or len(rows)!=len(ids):
        raise ValueError('Analysis must cover every article exactly once')
    for a in rows:
        if not a['summary'] or not isinstance(a['summary'],str) or not isinstance(a['relevance'],str):
            raise ValueError('Invalid analysis')
        if not set(a['purpose_ids'])<=purposes: raise ValueError('Unknown purpose')
    for c in result['candidates']:
        if c['purpose_id'] not in purposes or not c['question'].strip() or not c['title'].strip():
            raise ValueError('Invalid candidate')
        if not c['evidence_ids'] or not set(c['evidence_ids'])<=ids: raise ValueError('Invalid candidate evidence')
    seen=set()
    for e in result['evaluations']:
        if e['track_id'] not in tracks or e['track_id'] in seen: raise ValueError('Unknown or duplicate track')
        seen.add(e['track_id'])
        if not e['evidence_ids'] or not set(e['evidence_ids'])<=ids: raise ValueError('Invalid track evidence')
        for k in ('summary','change','counter_evidence','next_question'):
            if not isinstance(e[k],str): raise ValueError('Invalid evaluation field')
    return result
