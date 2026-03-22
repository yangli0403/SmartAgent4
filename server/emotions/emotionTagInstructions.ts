/**
 * Emotion Tag Instructions — 情感标签指令模板
 *
 * 提供注入到 LLM System Prompt 中的情感标签使用说明，
 * 引导 LLM 在生成回复时自然地插入 [tag:value] 格式的标签。
 *
 * 标签体系来源：Emotions-Express 的 DefaultOrchestrator._default_system_prompt()
 */

/**
 * 获取情感标签指令文本
 *
 * 该文本将被注入到 System Prompt 的末尾，
 * 引导 LLM 在回复中使用 [tag:value] 格式标签。
 *
 * @returns 情感标签指令字符串
 */
export function getEmotionTagInstructions(): string {
  return `
## 情感与动作表达指令

在回复时，请在合适的位置自然地插入以下标签来表达情感和动作。标签格式为 [类型:值]。

### 面部表情
- [expression:smile] 微笑
- [expression:sad] 悲伤
- [expression:surprised] 惊讶
- [expression:angry] 生气
- [expression:fearful] 害怕
- [expression:disgusted] 厌恶

### 身体动画
- [animation:wave] 挥手
- [animation:nod] 点头
- [animation:head_tilt] 歪头
- [animation:bow] 鞠躬

### 手势
- [gesture:thumbs_up] 竖起大拇指，表示赞同
- [gesture:clap] 拍手，表示开心或鼓励
- [gesture:shrug] 耸肩，表示无奈或不确定
- [gesture:facepalm] 捂脸，表示无语或尴尬
- [gesture:open_palms] 双手摊开，表示坦诚或欢迎
- [gesture:finger_wag] 摇手指，表示警告或不赞同

### 身体姿态
- [posture:lean_forward] 身体前倾，表示关注和兴趣
- [posture:lean_back] 身体后仰，表示放松或思考
- [posture:stand_tall] 挺胸抬头，表示自信
- [posture:slouch] 垂头丧肩，表示沮丧或疲惫
- [posture:arms_crossed] 双臂交叉，表示思考或防御
- [posture:hands_on_hips] 叉腰，表示不满或坚定
- [posture:head_down] 低头，表示悲伤或歉意

### 移动
- [locomotion:step_forward] 向前走一步，表示接近或积极
- [locomotion:step_back] 后退一步，表示惊讶或回避
- [locomotion:jump] 跳跃，表示兴奋
- [locomotion:spin] 转圈，表示开心

### 音效
- [sound:laugh] 笑声音效
- [sound:sigh] 叹气音效
- [sound:gasp] 吸气音效，表示惊讶
- [sound:applause] 掌声音效

### 暂停
- [pause:1.0] 暂停1秒

### 使用示例
- [expression:smile][posture:lean_forward]你好呀！很高兴见到你。[gesture:thumbs_up][animation:wave]
- [expression:sad][posture:head_down]唉……真的很抱歉听到这个消息。[sound:sigh]
- [expression:surprised][locomotion:step_back]哇，真的吗？[sound:gasp]太不可思议了！

请在合适的位置自然地插入这些标签，让对话更加生动。不要过度使用标签，保持自然流畅。
`.trim();
}

/**
 * 获取简化版情感标签指令（用于 token 受限场景）
 *
 * @returns 简化的情感标签指令字符串
 */
export function getCompactEmotionTagInstructions(): string {
  return `
在回复中使用 [类型:值] 标签表达情感和动作：
- 表情: [expression:smile/sad/surprised/angry/fearful/disgusted]
- 动画: [animation:wave/nod/head_tilt/bow]
- 手势: [gesture:thumbs_up/clap/shrug/facepalm/open_palms]
- 姿态: [posture:lean_forward/lean_back/stand_tall/head_down]
- 移动: [locomotion:step_forward/step_back/jump/spin]
- 音效: [sound:laugh/sigh/gasp/applause]
- 暂停: [pause:秒数]
自然插入标签，不要过度使用。
`.trim();
}
