from .records import parse_record
class NdjsonDecoder:
 def __init__(self,max_line_bytes=1024):
  if type(max_line_bytes) is not int or max_line_bytes<1:raise ValueError('Invalid limit')
  self.limit=max_line_bytes;self.pending=b'';self.state='open'
 def _record(self,line):
  if len(line)>self.limit or b'\r' in line:raise ValueError('Invalid line')
  return [] if not line.strip(b' 	') else [parse_record(line)]
 def feed(self,chunk):
  if self.state!='open':raise ValueError('Decoder closed')
  try:
   if not isinstance(chunk,bytes):raise ValueError('Bytes required')
   self.pending+=chunk;parts=self.pending.split(b'\n');self.pending=parts.pop();out=[]
   for line in parts:out+=self._record(line[:-1] if line.endswith(b'\r') else line)
   partial=self.pending[:-1] if self.pending.endswith(b'\r') else self.pending
   if len(partial)>self.limit or b'\r' in partial:raise ValueError('Invalid pending line')
   return out
  except Exception:
   self.state='failed';raise
 def finish(self):
  if self.state=='failed':raise ValueError('Decoder failed')
  if self.state=='finished':return []
  try:
   out=self._record(self.pending);self.pending=b'';self.state='finished';return out
  except Exception:
   self.state='failed';raise
