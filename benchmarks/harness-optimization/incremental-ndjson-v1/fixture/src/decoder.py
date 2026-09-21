from .records import parse_record
class NdjsonDecoder:
 def __init__(self,max_line_bytes=1024):self.pending=b''
 def feed(self,chunk):
  self.pending+=chunk;parts=self.pending.split(b'\n');self.pending=parts.pop();return [parse_record(x) for x in parts if x]
 def finish(self):return []
