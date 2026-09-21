import json,sys
from pathlib import Path
from events import parse_events
from report import reconcile
if __name__=='__main__':
    print(json.dumps(reconcile(parse_events(Path(sys.argv[1]).read_text()),sys.argv[2],sys.argv[3])))
