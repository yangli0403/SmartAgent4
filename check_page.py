import requests
r = requests.get('http://127.0.0.1:3000', timeout=5)
print('status:', r.status_code)
print('has root div:', 'id="root"' in r.text)
print('snippet:', r.text[:300])
