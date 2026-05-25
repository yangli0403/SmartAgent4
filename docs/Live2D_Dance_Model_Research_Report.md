# SmartAgent4 Live2D 舞蹈动作模型调研与集成方案

## 一、 调研背景与问题根因

在当前版本的 SmartAgent4 中，当用户请求“跳个舞”时，系统回复“虽然我不能实际跳舞给您看...”，并且没有表现出明显的舞蹈动作。经过对仓库设计文档（如 `LIVE2D_EXTENSION_PLAN.md`）和前端代码的分析，根本原因如下：

1. **当前模型限制**：系统当前使用的默认模型 **Haru Greeter**（`haru_greeter_t03`）仅包含 2 个 Motion Group（`Idle` 和 `Tap`）共 5 个物理动作。模型本身**没有内置任何真实的舞蹈骨骼动画**。
2. **参数驱动的模拟方案**：由于缺乏原生舞蹈动作，系统在 `parameterCombinations.ts` 中通过“参数驱动”方案（调整身体旋转 `ParamBodyAngleY` 和前倾 `ParamBodyAngleX` 等参数）模拟了 `spin`（转圈）和 `jump`（跳跃）动作。
3. **标签解析限制**：这些模拟动作通过 `[locomotion:spin]` 或 `[locomotion:jump]` 标签触发，但在当前的提示词和逻辑中，大模型并没有被充分引导在回复“跳舞”请求时输出这些特定标签，或者这些参数动画的幅度较小，难以被识别为“舞蹈”。

因此，要实现真正的舞蹈表现，必须引入具备专属 `Dance` 或丰富动作组的开源 Live2D 模型。

## 二、 开源 Live2D 模型资源调研

针对包含丰富动作（特别是舞蹈动作）的 Live2D 模型，本次调研考察了官方示例库、开源项目库及社区收集资源，结果如下：

### 1. Live2D 官方 CubismWebSamples 示例模型
Live2D 官方提供了一系列用于 SDK 测试的免费示例模型。我们批量查询了这些模型的 Motion Group：
- **Haru**：Idle(2), TapBody(4)
- **Hiyori**：Idle(9), TapBody(1)
- **Mao**：Idle(2), TapBody(6)
- **Mark**：Idle(6)
- **Natori**：Idle(3), TapBody(5)
- **Wanko**：Idle(3), TapBody(2)

**结论**：官方基础示例模型均只包含 `Idle` 和 `TapBody` 基础动作组，**不包含专属的舞蹈（Dance）动作**。

### 2. 社区开源 VTuber 与助手模型项目

#### Open-LLM-VTuber 项目
该项目是一个开源的语音交互 AI 伴侣项目，内置了多个 Live2D 模型（存放于 `live2d-models` 目录）。
- **内置模型**：目前主要提供 `mao_pro` 和 `shizuku` 模型。
- **动作情况**：`mao_pro` 是 Live2D 官方的 PRO 版示例模型，依然只有 `Idle` 和 `TapBody` 动作组；`shizuku` 模型包含 `idle`, `tap_body`, `pinch_in`, `pinch_out`, `shake`, `flick_head` 等基础交互动作，但同样**没有舞蹈动作**。

#### Pio 模型 (社区广泛使用的看板娘)
Pio 是一款常用于网页看板娘的开源模型。
- **动作情况**：包含 `idle` (7 个动作) 和默认组 (27 个动作，如 `Sleeping`, `Success`, `Sukebei`, `Touch`, `WakeUp` 等)。
- **结论**：动作非常丰富，适合做交互反馈，但**未包含专门的舞蹈动作**。

#### 游戏提取模型（如碧蓝航线）
在 GitHub 的 `imuncle/live2d` 仓库中，收集了大量碧蓝航线等游戏的 Live2D 模型。
- **动作情况**：以埃尔德里奇（aierdeliqi）模型为例，包含 15 个动作，主要为待机、点击反馈和技能释放。
- **结论**：游戏模型动作丰富且精美，但版权限制严格，且通常不包含长段的舞蹈表演动作。

## 三、 中期解决方案与集成建议

由于直接找到既免费开源、允许商业使用，又自带现成高质量“舞蹈”动作组的 Live2D 模型非常困难，针对 SmartAgent4 的中期演进，提出以下三种解决方案：

### 方案 A：引入专用的 MMD 舞蹈动画转 Live2D（技术路线）
目前社区有技术方案（如 MikuDance）探索将 3D 动作捕捉或 MMD 动作映射到 2D 空间。
- **实施方法**：利用 VTube Studio 的外部应用通信功能或社区转换脚本，将现成的免费 MMD 舞蹈动作（如《Sign wa B》等）转换为 Live2D 参数序列。
- **可行性**：技术门槛较高，但可以彻底解决 2D 模型缺乏长段舞蹈动画的问题。

### 方案 B：扩展现有的参数驱动方案（当前最优解）
既然系统已经实现了 `parameterCombinations.ts`，可以通过组合现有的动作和参数，编排一段“舞蹈”。
- **实施方法**：
  1. 在 `parameterCombinations.ts` 中新增一个复合动作 `dance`。
  2. 将 `spin`、`jump`、`idle_sway`（摇晃）以及手臂参数按时间序列组合，形成一段持续 3-5 秒的舞蹈循环。
  3. 在 `generalAgent.ts` 的系统提示词中，明确告知大模型：当用户要求跳舞时，请输出 `[locomotion:dance]` 标签，并配上欢快的语音和音效（如 `[sound:applause]`）。

### 方案 C：采购或定制包含 Dance Group 的模型
如果项目有进一步的预算或资源：
- **实施方法**：在 Live2D 官方模型商店（nizima）寻找带有舞蹈动画的模型，或雇佣 Live2D 动画师为现有的 Haru 模型制作 1-2 个专属的舞蹈 `.mtn` / `.motion3.json` 文件。
- **集成方式**：将新制作的舞蹈动作放入模型的 `motions` 文件夹，并在 `model3.json` 中新增 `"Dance"` Motion Group，随后在前端的 `motionMapping.ts` 中进行映射。

## 四、 总结

开源界高质量的 Live2D 模型大多侧重于面部捕捉（VTuber）和基础点击反馈（看板娘），**几乎没有自带现成舞蹈动作的开源免费模型**。

对于 SmartAgent4 而言，**最快且最现实的中期方案是深化当前的“参数驱动”机制**，通过代码编排多参数的连续变化来模拟舞蹈，同时优化大模型的 Prompt，使其能够准确触发对应的标签。
