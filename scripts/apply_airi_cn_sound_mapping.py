import json
path = '/home/ubuntu/SmartAgent4/client/public/live2d/haru/haru_greeter_t03.model3.json'
with open(path, 'r') as f: data = json.load(f)
data['FileReferences']['Motions']['Tap'] = [
    {'File': 'motion/haru_g_m15.motion3.json', 'Sound': 'sounds_cn/listen.wav'},
    {'File': 'motion/haru_g_m05.motion3.json', 'Sound': 'sounds_cn/think.wav'},
    {'File': 'motion/haru_g_m07.motion3.json', 'Sound': 'sounds_cn/tool.wav'},
    {'File': 'motion/haru_g_m14.motion3.json', 'Sound': 'sounds_cn/success.wav'},
    {'File': 'motion/haru_g_idle.motion3.json', 'Sound': 'sounds_cn/error.wav'},
    {'File': 'motion/haru_g_m15.motion3.json', 'Sound': 'sounds_cn/ack.wav'}
]
with open(path, 'w') as f: json.dump(data, f, indent=2)
