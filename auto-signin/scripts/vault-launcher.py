"""Profile-local vault bridge. Never emits or persists resolved credentials.

Only the canonical sign-in CLI and explicitly bound platform origins are accepted.
The final exec preserves the PID, so runner timeouts still terminate the browser job.
"""
import argparse
import json
import os
from pathlib import Path
import sys

ORIGINS={
    'cordcloud':'https://www.cordcloud.us',
    'jd':'https://www.jd.com',
    'taobao':'https://www.taobao.com',
    'wps':'https://www.wps.cn',
}

def credentials_for(store, handle, platform):
    if platform not in ORIGINS:
        raise ValueError('Unsupported platform')
    meta=store.get_meta(handle)
    if not meta or meta.kind!='login' or meta.origin!=ORIGINS[platform] or not meta.identifier:
        raise ValueError('Vault binding does not match the approved platform origin')
    secret=store.resolve_secret(handle)
    password=secret.get('password')
    if not isinstance(password,str) or not password:
        raise ValueError('Vault login has no password')
    prefix=platform.upper()
    return {prefix+('_EMAIL' if platform=='cordcloud' else '_USERNAME'):meta.identifier,prefix+'_PASSWORD':password}

def main():
    parser=argparse.ArgumentParser(description='Launch a bound sign-in job without exporting secrets')
    parser.add_argument('--handle',required=True)
    parser.add_argument('--platform',choices=list(ORIGINS),required=True)
    parser.add_argument('command',nargs=argparse.REMAINDER)
    args=parser.parse_args()
    command=args.command[1:] if args.command[:1]==['--'] else args.command
    expected=Path(__file__).with_name('auto-signin.mjs').resolve()
    try:
        if len(command)<7 or Path(command[1]).resolve()!=expected or command[2:5]!=['run','--platform',args.platform] or command[5]!='--state-dir':
            raise ValueError('Only the canonical platform runner may receive credentials')
        if not Path(command[0]).is_absolute():
            raise ValueError('Node executable must be absolute')
        sys.path.insert(0,'/opt/hermes')
        from agent.vault_store import VaultStore
        from hermes_cli.config import get_hermes_home
        # Explicit current-profile vault; no scanning or fallback to another profile.
        store=VaultStore(Path(get_hermes_home())/'vault')
        credentials=credentials_for(store,args.handle,args.platform)
        env={**os.environ,**credentials,'AUTO_SIGNIN_NONINTERACTIVE':'1'}
        os.execve(command[0],command,env)
    except Exception:
        # Do not echo exception messages: vault backends may include sensitive details.
        print(json.dumps({'status':'failed','platform':args.platform,'code':'vault_credentials_unavailable','message':'Approved vault login could not be supplied; check the binding and vault access.'}))
        return 20

if __name__=='__main__':
    sys.exit(main())
