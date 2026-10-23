"""Subscription-authenticated local Claude Code fallback, pinned to Haiku 5.5."""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from .codex import Codex, CodexFailure, safe_env


def search_events(events):
    """Normalize actual Claude WebSearch link records to the evidence protocol."""
    calls={};normalized=[]
    for event in events:
        if event.get('parent_tool_use_id'):continue
        content=event.get('message',{}).get('content',[])
        if not isinstance(content,list):continue
        for block in content:
            if not isinstance(block,dict):continue
            if block.get('type')=='tool_use' and block.get('name')=='WebSearch':
                calls[block['id']]=block.get('input',{}).get('query','')
            if block.get('type')!='tool_result' or block.get('tool_use_id') not in calls or block.get('is_error'):continue
            results=[]
            body=block.get('content',[])
            if isinstance(body,str):body=[{'type':'text','text':body}]
            for item in body:
                if not isinstance(item,dict):continue
                if item.get('type')=='web_search_result' and item.get('url'):
                    results.append({'type':'text_result','url':item['url'],'title':item.get('title',''),'snippet':item.get('snippet','')})
                text=item.get('text','')
                # Native WebSearch returns its link list as JSON after the literal marker.
                # Never mine arbitrary URLs from snippets, prompts, or assistant text.
                if 'Links: ' not in text:continue
                try:links,_=json.JSONDecoder().raw_decode(text.split('Links: ',1)[1].lstrip())
                except ValueError:continue
                if not isinstance(links,list):continue
                for link in links:
                    if isinstance(link,dict) and link.get('url'):
                        results.append({'type':'text_result','url':link['url'],'title':link.get('title',''),'snippet':link.get('snippet','')})
            normalized.append({'type':'item.completed','item':{'type':'web_search',
                'action':{'type':'search','query':calls[block['tool_use_id']]},'results':results}})
    return normalized


class Claude(Codex):
    provider='claude'

    def __init__(self,binary=None,model=None):
        local=Path(__file__).resolve().parent.parent/'.data/claude-cli/node_modules/.bin/claude'
        self.binary=binary or os.environ.get('CLAUDE_BIN') or shutil.which('claude') or str(local)
        self.model=model or os.environ.get('CLAUDE_MODEL','claude-haiku-5-5')
        self.reasoning_effort=os.environ.get('CLAUDE_REASONING_EFFORT','medium')

    def environment(self):
        env=safe_env()
        env.pop('CODEX_HOME',None)
        if os.environ.get('CLAUDE_CONFIG_DIR'):env['CLAUDE_CONFIG_DIR']=os.environ['CLAUDE_CONFIG_DIR']
        return env

    def ensure_ready(self):
        try:
            result=subprocess.run([self.binary,'--safe-mode','--restricted','--setting-sources','','auth','status'],capture_output=True,text=True,env=self.environment(),timeout=20)
            auth=json.loads(result.stdout)
        except (OSError,ValueError,subprocess.TimeoutExpired) as e:
            raise CodexFailure('Local Claude CLI unavailable; install and sign in with a Claude subscription','fallback_unavailable') from e
        if result.returncode or not auth.get('loggedIn') or auth.get('authMethod')!='claude.ai' or auth.get('apiProvider')!='firstParty':
            raise CodexFailure('Run local Claude auth login --claudeai; subscription authentication is required','fallback_auth_required')

    def execute(self,prompt,schema,search=False):
        self.ensure_ready()
        tools='WebSearch,WebFetch' if search else ''
        args=[self.binary,'--print','--model',self.model,'--effort',self.reasoning_effort,
              '--safe-mode','--restricted','--setting-sources','',
              '--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
              '--tools',tools,'--allowedTools',tools,'--permission-mode','dontAsk',
              '--no-session-persistence','--output-format','stream-json','--verbose',
              '--json-schema',Path(schema).read_text()]
        with tempfile.TemporaryDirectory(prefix='shixun-claude-') as directory:
            try:
                response=subprocess.run(args,input=prompt,text=True,capture_output=True,
                                        cwd=directory,env=self.environment(),timeout=600)
            except (OSError,subprocess.TimeoutExpired) as e:
                raise CodexFailure('Local Claude did not finish; work retained','fallback_model_failed') from e
        events=[]
        for line in response.stdout.splitlines():
            try:events.append(json.loads(line))
            except ValueError:continue
        final=next((e for e in reversed(events) if e.get('type')=='result'),{})
        if response.returncode or final.get('is_error') or not final:
            errors={e.get('error') for e in events if isinstance(e.get('error'),str)}
            blocked=any(e.get('type')=='rate_limit_event' and e.get('rate_limit_info',{}).get('status')=='rejected' for e in events)
            code=('fallback_auth_required' if 'authentication_failed' in errors else
                  'fallback_waiting_quota' if blocked or 'rate_limit' in errors else 'fallback_model_failed')
            raise CodexFailure('Claude fallback did not complete; work retained',code)
        used=final.get('modelUsage',{})
        if not used or any(k!=self.model and not k.startswith(self.model+'-') for k in used):
            raise CodexFailure('Claude did not confirm the requested Haiku model; result not published','fallback_model_failed')
        if not isinstance(final.get('structured_output'),dict):
            raise CodexFailure('Claude returned no structured result','fallback_model_failed')
        return final['structured_output'],search_events(events)
