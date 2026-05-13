const fs = require('fs');
const path = require('path');
const targetDir = '/home/ubuntu/SmartAgent4/client/public/live2d/haru/sounds_cn';
if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
const sounds = [
  { name: 'listen.wav', text: '我在听，你说吧。' },
  { name: 'think.wav', text: '我想一下。' },
  { name: 'tool.wav', text: '我来处理一下。' },
  { name: 'success.wav', text: '完成了。' },
  { name: 'error.wav', text: '这里遇到点问题。' },
  { name: 'ack.wav', text: '嗯，我明白了。' }
];
sounds.forEach(s => fs.writeFileSync(path.join(targetDir, s.name), 'dummy audio content for demo'));
