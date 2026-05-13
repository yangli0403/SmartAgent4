import os, requests, json
def download(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    r = requests.get(url, timeout=30)
    with open(path, 'wb') as f: f.write(r.content)
base_url = "https://raw.githubusercontent.com/guansss/pixi-live2d-display/master/test/assets/haru/"
model_json_url = base_url + "haru_greeter_t03.model3.json"
local_dir = "/home/ubuntu/SmartAgent4/client/public/live2d/haru/"
download(model_json_url, local_dir + "haru_greeter_t03.model3.json")
with open(local_dir + "haru_greeter_t03.model3.json", 'r') as f: data = json.load(f)
for k in ['Moc3', 'Physics', 'DisplayInfo']:
    if k in data['FileReferences']: download(base_url + data['FileReferences'][k], local_dir + data['FileReferences'][k])
for tex in data['FileReferences']['Textures']: download(base_url + tex, local_dir + tex)
for m in data['FileReferences']['Motions'].values():
    for item in m: download(base_url + item['File'], local_dir + item['File'])
