# SmartAgent4 车载情感化语音与场景优化计划

**作者：Manus AI**
**日期：2026-04-13**

## 一、背景与目标

随着车载座舱智能化程度的加深，语音交互已经从纯功能性的指令执行，演变为驾驶员的“数字伴侣”。然而，过度或不当的情感表达不仅会显得做作，甚至可能干扰驾驶安全。真正优秀的情感化设计应当遵循“安全优先、情绪匹配、适度共情”的原则 [1]。

结合最新上传的《深度解析：车载座舱中真正需要情感化语音的场景与产品逻辑》文档，以及对 SmartAgent4 (windows-compat 分支) 代码库的深度分析，我们发现 SmartAgent4 已经在底层架构上具备了较好的多模态情感输出能力（如 `emotionsClient` 和 `AIRI Bridge`），并且在类型定义层面预留了车载配置（如 `VehicleConfig`）。

本计划旨在将文档中的产品逻辑与 SmartAgent4 的现有技术栈深度结合，细化出一套可落地的系统用户场景与情感优化方案，实现**“情境感知的情感分发”**。

---

## 二、当前 SmartAgent4 架构现状分析

在规划优化方案之前，我们首先盘点了 SmartAgent4 目前与情感化、车载场景相关的技术储备：

1. **情感表达与渲染层**：
   系统通过 `emotionsClient.ts` 已经能够解析 LLM 输出中的复合情感标签（如 `[emotion:happy|instruction:用欢快的语气]`），并调用后端的 TTS 服务生成带情感的语音 [2]。
   同时，`emotionTagInstructions.ts` 定义了丰富的表情、动作、姿态等标签体系，并在 `contextEnrichNode.ts` 中注入到了动态 System Prompt 中，引导 LLM 生成多模态回复 [3]。

2. **AIRI 角色表现层**：
   `emotionMapper.ts` 实现了从文本标签到 AIRI 虚拟人（Live2D/VRM）的表情（Expression）和动作（Motion）映射。这为车载座舱中的全息数字人或屏幕 Avatar 提供了基础 [4]。

3. **上下文与情境感知**：
   `state.ts` 和 `contextManager.ts` 中定义了 `UserContext`，已经包含了用户 ID、位置（经纬度、城市）、时间、时区以及用户设定的性格模式和回答风格。这为基于时间、地点的“触发器驱动”提供了直接的数据来源 [5]。

4. **车载预留配置**：
   在 `types.ts` 中，`AgentCharacter` 接口已经预留了 `vehicleConfig` 字段，包含了 `greetingTemplates`（问候模板）、`proactiveServiceRules`（主动服务规则，如低油量预警、通勤路线建议）和 `scenarioHandlers`（场景处理器）[6]。

**核心差距**：
目前系统默认在所有回复中都鼓励 LLM 使用情感标签，缺乏基于“场景分类”的动态降级或升级机制。例如，对于简单的车控指令，LLM 仍可能生成带有情感的回复，这违背了车载场景“禁忌场景保持中立”的原则 [1]。

---

## 三、车载情感化场景分级与产品逻辑细化

根据行业研究与驾驶心理学，我们将 SmartAgent4 的车载应用场景分为三个层级，并为其制定了相应的触发逻辑和情感约束。

### 1. 强需求场景（情感化是核心产品力）

在这些场景中，情感化语音是解决驾驶痛点、提升安全性和建立用户信任的关键手段。

| 场景分类 | 触发条件 (Trigger) | 期望情感 (Emotion/Tone) | 语音动作示例 |
| :--- | :--- | :--- | :--- |
| **负面情绪干预** | 传感器检测到路怒、频繁按喇叭、叹气，或长时间拥堵 | Sad / Calm / Caring | `[emotion:calm][expression:sad]` "别着急，前方确实有些拥堵，我已经为您开启了座椅按摩，放一首您喜欢的轻音乐吧。" |
| **疲劳驾驶干预** | DMS 摄像头检测到疲劳，或连续驾驶超过 3 小时 | Caring / Serious | `[emotion:caring][posture:lean_forward]` "您已经连续驾驶三个小时了，听声音感觉您有些疲惫，前方五公里有服务区，去喝杯咖啡休息一下吧。" |
| **紧急安全预警** | 车辆传感器报出严重故障（如胎压骤降）、前车急刹 | Angry / Fearful / Urgent | `[emotion:urgent][expression:fearful]` "警告，左前轮胎压异常！请立刻紧握方向盘，向右侧安全地带靠停。" |
| **数字伴侣时刻** | 早晨首次上车、节假日、生日，或后排儿童哭闹 | Happy / Energetic / Gentle | `[emotion:happy][expression:smile]` "早上好！今天天气真不错，去公司的路上一路畅通，祝您有美好的一天！" |

### 2. 适度需求场景（情感化作为调味料）

用户的主要诉求是获取信息或执行指令，情感化只应在特定节点作为点缀。

| 场景分类 | 触发条件 (Trigger) | 期望情感 (Emotion/Tone) | 语音动作示例 |
| :--- | :--- | :--- | :--- |
| **复杂任务反馈** | 成功完成跨领域任务（如预订餐厅并发送导航到车机） | Happy | `[emotion:happy][gesture:thumbs_up]` "搞定啦！已经帮您订好了今晚七点的靠窗座位，现在就出发吗？" |
| **系统认错示弱** | 无法理解指令、网络断开、或工具调用失败 | Sad / Apologetic | `[emotion:sad][posture:head_down]` "哎呀，刚刚信号不太好，我没听清，能麻烦您再说一遍吗？" |

### 3. 禁忌场景（绝对需要保持中立 Neutral）

在这些场景中，强行加入情感是极其糟糕的体验，必须保持中立，确保高效和不打扰。

| 场景分类 | 触发条件 (Trigger) | 期望情感 (Emotion/Tone) | 语音动作示例 |
| :--- | :--- | :--- | :--- |
| **高频车控指令** | 打开车窗、调节空调温度等单步简单操作 | Neutral | `[emotion:neutral]` "好的。"（必须极其简短） |
| **客观资讯播报** | 播报新闻、股市、天气等客观事实 | Neutral | `[emotion:neutral]` "今天北京晴转多云，最高气温 25 度。" |
| **常规导航提示** | "前方 500 米向右变道" 等高频导航指令 | Neutral | `[emotion:neutral]` "前方 500 米向右变道。" |

---

## 四、SmartAgent4 情感优化实施计划

为了将上述产品逻辑落地到 SmartAgent4 的代码架构中，我们制定了以下四个阶段的优化实施计划。

### 阶段一：实现“情境感知的情感分发”机制

当前系统在 `contextEnrichNode.ts` 中总是注入完整的情感标签指令。我们需要将其改造为基于意图和场景的动态注入。

1. **引入场景拦截器 (Scenario Interceptor)**：
   在 `classifyNode.ts` 进行意图分类后，增加一个步骤，判断当前任务是否属于“禁忌场景”（如 `domain: file_system` 的底层操作，或高频的简单导航）。如果是，则在传递给 `respondNode.ts` 的 `SupervisorState` 中打上 `requireNeutral: true` 的标记。
2. **动态 System Prompt 降级**：
   修改 `respondNode.ts`，当检测到 `requireNeutral: true` 时，从 System Prompt 中剥离情感标签指令，或者明确要求 LLM：“当前为高频操作，请仅输出 `[emotion:neutral]` 标签，并使用最简短的确认话术”。

### 阶段二：打通车辆传感器与环境数据 (Trigger 接入)

车载情感的核心在于“触发器驱动”。我们需要扩展 `UserContext`，使其能够接收来自车机的实时数据。

1. **扩展 ContextManager**：
   在 `UserContext` 接口中增加 `vehicleState` 对象，包含 `drivingTime`（连续驾驶时间）、`dmsStatus`（疲劳/情绪状态）、`vehicleAlerts`（车辆故障告警）等字段。
2. **前置增强节点的规则引擎**：
   在 `contextEnrichNode.ts` 中，当检测到特定的 `vehicleState`（如疲劳或故障）时，直接向 `dynamicSystemPrompt` 顶部强插最高优先级的指令（例如：“检测到驾驶员疲劳，你必须使用关切的语气 `[emotion:caring]` 进行安抚和提醒”）。

### 阶段三：激活 VehicleConfig 与主动服务

利用已经在 `types.ts` 中定义的 `VehicleConfig`，实现“数字伴侣时刻”。

1. **通勤问候与主动推荐**：
   当用户上车（建立新 Session）且时间符合早晚高峰时，读取 `xiaozhi.json` 中的 `proactiveServiceRules`。
2. **免唤醒的场景处理器**：
   实现 `scenarioHandlers`，当触发条件满足时（如检测到低油量），无需用户开口，系统主动生成一段带有 `[emotion:caring]` 的提示语音。

### 阶段四：梯度表达与 CosyVoice 3.5 深度整合

利用先进的 TTS 能力，实现同一句话中情绪的起伏。

1. **复合标签解析优化**：
   目前 `emotionsClient.ts` 已经支持切分带有多个情感标签的文本段落。我们需要进一步优化，使得 LLM 能够生成如：“`[emotion:urgent]` 注意前方急刹车！`[pause:0.5][emotion:calm]` 危险已解除，您可以继续安全行驶。” 这样的复合指令。
2. **AIRI 动作连贯性优化**：
   在 `emotionMapper.ts` 中，确保当情感从 Urgent 突变到 Calm 时，虚拟人的动作（Motion）能够平滑过渡，避免出现动作撕裂。

---

## 五、总结

通过上述优化计划，SmartAgent4 将从一个“总是试图表现情感”的通用对话系统，蜕变为一个**“懂分寸、知进退”**的专业车载数字伴侣。80% 的日常交互将被锁定在中性语调，确保高效安全；而在关键的疲劳、紧急或安抚场景下，系统将通过精准的情感分发，提供直击人心的温暖体验。

---

## References

[1] 深度解析：车载座舱中真正需要情感化语音的场景与产品逻辑. 
[2] SmartAgent4 源代码: `server/emotions/emotionsClient.ts`
[3] SmartAgent4 源代码: `server/emotions/emotionTagInstructions.ts` 和 `server/agent/supervisor/contextEnrichNode.ts`
[4] SmartAgent4 源代码: `server/airi-bridge/emotionMapper.ts`
[5] SmartAgent4 源代码: `server/agent/supervisor/state.ts` 和 `server/context/contextManager.ts`
[6] SmartAgent4 源代码: `server/personality/types.ts`
