"""Local-only UI server and CPU pose worker. Bind to loopback; no external upload.

Run after installing analysis/requirements.txt. The prebuilt ui/ directory is
included in the downloadable package; source checkouts use dist instead.
"""
import argparse,hashlib,importlib.util,json,mimetypes,os,re,subprocess,sys,tempfile,threading,time,uuid
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse,parse_qs

ROOT=Path(__file__).resolve().parent.parent
UI=ROOT/'ui' if (ROOT/'ui').exists() else ROOT/'dist'
JOBS={};LOCK=threading.Lock();TEMP=tempfile.TemporaryDirectory(prefix='shotlab-')
READY=all(importlib.util.find_spec(x) for x in ['mediapipe','cv2','numpy'])
MAX_BYTES=2*1024**3

def model_path():
 p=Path(TEMP.name)/'pose-heavy.task'
 with LOCK:
  if not p.exists():
   public=ROOT/'public' if (ROOT/'public'/'models').exists() else UI
   p.write_bytes(b''.join((public/'models'/f'pose-heavy-{i}.bin').read_bytes() for i in range(2)))
 return p

def worker(job,video,roi,filename):
 out=video.with_suffix('.json')
 try:
  command=[sys.executable,str(ROOT/'analysis'/'extract.py'),str(video),'--model',str(model_path()),'--out',str(out),'--roi',','.join(map(str,roi))]
  proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
  job['process']=proc;lines=[]
  for line in proc.stdout:
   lines.append(line);m=re.search(r'(\d+)/(\d+) frames',line)
   if m:job['progress']=int(m[1])/max(1,int(m[2]))
  if proc.wait():raise RuntimeError(''.join(lines[-12:]))
  d=json.loads(out.read_text());d['meta']['filename']=filename;d['meta']['source_sha256']=hashlib.file_digest(video.open('rb'),'sha256').hexdigest();d['meta']['file_size']=video.stat().st_size
  out.write_text(json.dumps(d,separators=(',',':')))
  job.update(status='done',progress=1,result=out)
 except Exception as e:job.update(status='error',error=str(e))
 finally:job.pop('process',None)

class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(UI),**kwargs)
 def translate_path(self,path):
  resolved=super().translate_path(path)
  if Path(resolved).is_file():return resolved
  # The downloadable package keeps large model/video assets once, in public/.
  root=(ROOT/'public').resolve();candidate=(root/urlparse(path).path.lstrip('/')).resolve()
  if candidate.is_relative_to(root) and candidate.is_file():return str(candidate)
  return resolved
 def log_message(self,fmt,*args):pass
 def json(self,obj,status=200):
  body=json.dumps(obj,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
 def allowed(self):
  # Reject cross-origin state-changing requests and DNS-rebinding hosts.
  host=self.headers.get('Host','');origin=self.headers.get('Origin');return host in [f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'] and (not origin or origin in ['http://'+host])
 def do_GET(self):
  url=urlparse(self.path)
  if url.path=='/api/capabilities':return self.json({'local_cpu':bool(READY),'source_timestamps':True})
  if url.path.startswith('/api/jobs/'):
   key=url.path.rsplit('/',1)[-1];job=JOBS.get(key)
   if not job:return self.json({'error':'Unknown job'},404)
   if parse_qs(url.query).get('result') and job['status']=='done':return self.json(json.loads(job['result'].read_text()))
   return self.json({k:v for k,v in job.items() if k not in ['process','result']})
  return super().do_GET()
 def do_POST(self):
  if not self.allowed():return self.json({'error':'Origin not allowed'},403)
  url=urlparse(self.path)
  if url.path!='/api/analyze':return self.json({'error':'Not found'},404)
  if not READY:return self.json({'error':'Install analysis/requirements.txt first.'},503)
  try:
   length=int(self.headers.get('Content-Length',0));q=parse_qs(url.query);roi=json.loads(q.get('roi',['[0,0,1,1]'])[0]);filename=Path(q.get('filename',['video.mp4'])[0]).name
   if not 0<length<=MAX_BYTES:raise ValueError('Video must be between 1 byte and 2 GiB.')
   if len(roi)!=4 or not all(isinstance(x,(float,int)) and 0<=x<=1 for x in roi) or roi[2]-roi[0]<.03 or roi[3]-roi[1]<.03:raise ValueError('Invalid target region.')
   if any(j['status']=='running' for j in JOBS.values()):return self.json({'error':'Another analysis is running.'},409)
   key=uuid.uuid4().hex;folder=Path(TEMP.name)/key;folder.mkdir();video=folder/'video.mp4'
   remaining=length
   with video.open('wb') as f:
    while remaining:
     b=self.rfile.read(min(1024**2,remaining))
     if not b:raise ValueError('Incomplete upload')
     f.write(b);remaining-=len(b)
   job={'status':'running','progress':0};JOBS[key]=job;threading.Thread(target=worker,args=(job,video,roi,filename),daemon=True).start();return self.json({'job_id':key},202)
  except Exception as e:return self.json({'error':str(e)},400)
 def do_DELETE(self):
  if not self.allowed():return self.json({'error':'Origin not allowed'},403)
  key=urlparse(self.path).path.rsplit('/',1)[-1];job=JOBS.get(key)
  if job and job.get('process'):job['process'].terminate()
  return self.json({'cancelled':bool(job)})

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8765);a=p.parse_args()
 if not UI.exists():raise SystemExit('Missing prebuilt ui. Build the app first.')
 mimetypes.add_type('application/javascript','.mjs');mimetypes.add_type('application/wasm','.wasm')
 server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler)
 print(f'Open http://127.0.0.1:{a.port}  |  CPU analysis: {READY}',flush=True)
 try:server.serve_forever()
 except KeyboardInterrupt:pass
 finally:
  for j in JOBS.values():
   if j.get('process'):j['process'].terminate()
  server.server_close();TEMP.cleanup()
