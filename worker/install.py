"""Generate launch agents; explicit --enable installs a standalone user runtime."""
import argparse,plistlib,sys,os,subprocess,shutil,fcntl
from pathlib import Path
def main():
 p=argparse.ArgumentParser()
 p.add_argument('--interval-minutes',type=int)
 p.add_argument('--daily',action='store_true',help='Check cloud daily schedules every minute')
 p.add_argument('--enable',action='store_true',help='Install and load the explicitly selected launch agent')
 a=p.parse_args()
 if not a.daily and (a.interval_minutes is None or a.interval_minutes<15):p.error('Use --daily or --interval-minutes >= 15')
 root=Path(__file__).resolve().parent.parent
 out=root/'.data'/'launchd';out.mkdir(parents=True,exist_ok=True)
 runtime=root
 if a.enable:
  runtime=Path.home()/'Library/Application Support/Shixun'
  runtime.mkdir(parents=True,exist_ok=True,mode=0o700)
  runtime.chmod(0o700)
  shutil.copytree(root/'worker',runtime/'worker',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
  source_env=root/'.env.worker'
  settings=dict(line.split('=',1) for line in source_env.read_text().splitlines() if '=' in line and not line.startswith('#'))
  source_data=Path(settings.get('WORKER_DATA_DIR','.data'))
  if not source_data.is_absolute():source_data=root/source_data
  target_data=runtime/'data'
  if source_data.resolve()!=target_data.resolve():
   source_data.mkdir(parents=True,exist_ok=True)
   with open(source_data/'worker.lock','a') as lock:
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:p.error('Stop the running worker before installing its runtime')
    if target_data.exists():p.error('Runtime data already exists; reconcile the data directories first')
    shutil.copytree(source_data,target_data)
  target_data.mkdir(exist_ok=True,mode=0o700)
  settings['WORKER_DATA_DIR']=str(target_data)
  cli=root/'.data/claude-cli'
  if cli.exists():
   destination_cli=runtime/'claude-cli'
   shutil.copytree(cli,destination_cli,dirs_exist_ok=True,symlinks=True)
   settings['CLAUDE_BIN']=str(destination_cli/'node_modules/.bin/claude')
  env_text=''.join(key+'='+value+'\n' for key,value in settings.items())
  for target_env in (source_env,runtime/'.env.worker'):
   target_env.write_text(env_text);target_env.chmod(0o600)
 jobs=[('com.shixun.daily' ,'--scheduled',60)] if a.daily else [('com.shixun.collect','--once',a.interval_minutes*60),('com.shixun.recover','--monitor',300)]
 for label,mode,interval in jobs:
  config={'Label':label,'ProgramArguments':[sys.executable,'-m','worker.runner',mode],'WorkingDirectory':str(runtime),
          'StartInterval':interval,'RunAtLoad':False,'StandardOutPath':str(runtime/f'{label}.log'),
          'StandardErrorPath':str(runtime/f'{label}.error.log'),
          'EnvironmentVariables':{'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin','PYTHONPATH':str(runtime),'HOME':str(Path.home())}}
  target=out/(label+'.plist');target.write_bytes(plistlib.dumps(config))
  print('Generated:',target)
  if a.enable:
   destination=Path.home()/'Library/LaunchAgents'/(label+'.plist')
   destination.parent.mkdir(parents=True,exist_ok=True)
   subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}',str(destination)],capture_output=True)
   destination.write_bytes(plistlib.dumps(config))
   subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(destination)],check=True)
   print('Enabled:',label)
 if a.enable:return
 print('Review these intervals, then copy to ~/Library/LaunchAgents and use launchctl bootstrap gui/$(id -u) <plist>.')
 print('No service installed. Mac must be awake and logged in; verify after reboot on the actual host.')
if __name__=='__main__':main()
