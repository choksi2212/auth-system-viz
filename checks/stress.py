import httpx,json,concurrent.futures,time
from pathlib import Path
c=httpx.Client(base_url='http://localhost:3080/api',timeout=30)
r=c.post('/auth/login',json={'email':'keylogger2230@gmail.com','password':'VellumDemo1!'});r.raise_for_status();t=r.json();h={'Authorization':'Bearer '+t['access_token']}
start=time.monotonic();r=c.post('/vault/documents',headers=h,files={'file':('oversized.bin',b'x'*(30*1024*1024))});assert r.status_code==413,r.status_code
elapsed=round(time.monotonic()-start,3)
def probe(i):
 return c.get('/vault/documents',headers={'Authorization':'Bearer '+('invalid.'*5)+str(i)}).status_code
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:statuses=list(pool.map(probe,range(200)))
assert all(v==401 for v in statuses),set(statuses)
rate=[c.post('/auth/login',json={'email':'unregistered@example.com','password':'Wrong1!'}).status_code for _ in range(8)]
assert 429 in rate,rate
assert c.get('/users/me',headers=h).status_code==200
c.post('/auth/logout',json={'refresh_token':t['refresh_token']})
result={'malformed_token_requests':200,'concurrency':20,'all_rejected_401':True,'oversized_30MiB_status':r.status_code,'oversized_rejection_seconds':elapsed,'login_rate_limit_statuses':rate,'authenticated_service_remained_available':True}
Path('evidence/stress-results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
