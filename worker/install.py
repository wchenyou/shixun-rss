"""Generate, never silently install, launchd jobs for this checkout."""
import argparse,plistlib,sys
from pathlib import Path
def main():
 p=argparse.ArgumentParser()
 p.add_argument('--interval-minutes',type=int,required=True)
 a=p.parse_args()
 if a.interval_minutes<15:p.error('Use at least 15 minutes')
 root=Path(__file__).resolve().parent.parent
 out=root/'.data'/'launchd';out.mkdir(parents=True,exist_ok=True)
 for label,mode,interval in [('com.shixun.collect','--once',a.interval_minutes*60),('com.shixun.recover','--monitor',300)]:
  config={'Label':label,'ProgramArguments':[sys.executable,'-m','worker.runner',mode],'WorkingDirectory':str(root),
          'StartInterval':interval,'RunAtLoad':False,'StandardOutPath':str(root/'.data'/f'{label}.log'),
          'StandardErrorPath':str(root/'.data'/f'{label}.error.log'),
          'EnvironmentVariables':{'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'}}
  target=out/(label+'.plist');target.write_bytes(plistlib.dumps(config))
  print('Generated:',target)
 print('Review these intervals, then copy to ~/Library/LaunchAgents and use launchctl bootstrap gui/$(id -u) <plist>.')
 print('No service installed. Mac must be awake and logged in; verify after reboot on the actual host.')
if __name__=='__main__':main()
