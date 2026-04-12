# AIRI 开源仓库复用评估与 SmartAgent4 集成建议（0412）

**作者：Manus AI**

## 一、结论摘要

针对用户提出的两个问题，本次补充调研后的结论可以明确写成两句话。第一，**已经调研过 AIRI 开源代码仓库，而且结论是“可以复用不少代码，但不建议整仓硬搬”**。Project AIRI 主仓库本身就是一个包含 Web、桌面和移动端的 monorepo，明确提供浏览器版 Stage Web，并在官方 README 中声明支持 **Web / macOS / Windows**，同时列出 **VRM support** 与 **Live2D support** [1] [2]。这意味着，如果 SmartAgent4 只是想尽快落地一个“方案 C：2D 角色舞台预览版”，并不需要从零开始写 Live2D 展示层，确实可以通过复用 AIRI 现成的前端舞台代码来显著降低成本。

第二，**用户对当前 SmartAgent4 现状的理解基本准确**。本地仓库检索表明，SmartAgent4 目前已经具备 `server/airi-bridge/` 后端桥接层，能够通过 WebSocket 与 AIRI Server Runtime 建立连接，并在 `chat.sendMessage` 成功返回后把回复转发给 AIRI；但是在 `client/src` 下并没有发现 `airi`、`live2d`、`vrm`、`pixi`、`three` 等浏览器端舞台渲染实现文件。因此，当前状态更准确地说是：**已有 AIRI Runtime 接口接入能力，但几乎没有浏览器端角色展示层。**

## 二、AIRI 开源仓库中哪些代码值得复用

从仓库结构看，AIRI 并不是只有一个演示页面，而是较完整地拆成多个工作区。其 `apps/stage-web` 是浏览器端应用，`packages/stage-ui` 是 Web 与桌面舞台共享的核心业务层，`packages/stage-ui-live2d` 是 Live2D 专用前端组件包，`packages/stage-ui-three` 则承担 VRM/Three.js 相关能力 [3] [4] [5]。这说明 AIRI 的角色舞台能力已经被拆解为可组合的模块，而不是写死在某一个页面里。

| 模块 | 仓库位置 | 可复用价值 | 对 SmartAgent4 的建议 |
| --- | --- | --- | --- |
| 浏览器端舞台应用 | `apps/stage-web` | 高 | 适合作为参考实现与交互蓝本，不建议整仓直接嵌入 React 主前端 |
| 舞台共享业务层 | `packages/stage-ui` | 中高 | 可借鉴 store、角色状态组织、场景组件结构，但宜按需裁剪 |
| Live2D 渲染层 | `packages/stage-ui-live2d` | 很高 | 是最适合做方案 C 的直接复用对象 |
| VRM/3D 渲染层 | `packages/stage-ui-three` | 中高 | 可作为后续升级路线，不建议在第一阶段就并入 |
| AIRI 原生服务端/认证链路 | `apps/server`、`packages/server-sdk` 等 | 中 | 仅在未来需要深度对齐 AIRI 原生生态时再考虑引入 |

尤其值得注意的是，`packages/stage-ui-live2d` 的导出入口已经明确暴露了 `Live2D.vue`、`stores/live2d`、`utils/live2d-preview`、`utils/live2d-zip-loader`、`utils/opfs-loader` 等模块 [4]。这类导出方式说明它本身就是可复用的前端组件包，而不是单纯资源样例。换言之，SmartAgent4 若希望先做轻量级角色舞台，完全可以优先复用这部分逻辑。

## 三、能否“直接复用大量代码”，从而让方案 C 的成本不大

答案是：**可以复用大量代码，但需要“模块级复用”，而不是“应用级整体搬运”。**

这是因为 AIRI 当前的 Web 端是 **Vue 3 + Vite + Pinia + UnoCSS** 技术栈，SmartAgent4 当前前端则是 **React 19 + TypeScript + Vite + TailwindCSS**。如果试图把 `apps/stage-web` 整个嵌进现有前端，不仅会遇到框架差异，还会连带引入其路由、状态管理、样式体系以及部分与 AIRI 自身服务契约相关的逻辑。这样做虽然理论可行，但工程边界会迅速扩大，最终成本未必比自己写一个简化版低。

更合适的做法，是把 AIRI 当作一个**前端舞台能力来源**。也就是说，保留 SmartAgent4 自己的 React 主应用与多智能体后端，只在前端新增一个相对独立的 `airi_stage` 子模块，专门承担角色渲染、动作驱动、表情同步和资源管理。这样既能复用 AIRI 已成熟的 Live2D/VRM 相关代码，又能避免把整个 AIRI 应用栈、认证体系和业务约束强行带入 SmartAgent4。

| 复用策略 | 可行性 | 成本判断 | 结论 |
| --- | --- | --- | --- |
| 直接搬运 `apps/stage-web` 整个 Web 应用 | 中 | 中高 | 不推荐作为首选 |
| 抽取 `packages/stage-ui-live2d` 做独立舞台模块 | 高 | 中低 | **推荐作为方案 C 主路径** |
| 再叠加 `packages/stage-ui` 部分状态与交互层 | 中高 | 中 | 适合作为第二阶段补强 |
| 一开始就并入 `packages/stage-ui-three` 做 VRM/3D | 中 | 中高 | 作为后续升级路线 |

因此，如果用户的目标是“尽快把 SmartAgent4 的 AIRI 展示补齐到可演示状态”，那么 **方案 C 并不是高成本项目**。它的难点不在渲染技术从零起步，而在于如何把 AIRI 的现有前端渲染能力，以最小耦合方式嫁接到 SmartAgent4 现有产品结构里。

## 四、对“当前 SmartAgent4 是否只有接口、没有展示层”的确认

本地代码证据显示，SmartAgent4 的 AIRI 集成目前主要完成了三个层面。第一是连接层，即 `AiriBridgeService` 负责与 AIRI Server Runtime 建立 WebSocket 连接；第二是协议适配层，即将 SmartAgent4 的回复、情感标签和音频信息转换为 AIRI 可接受的消息结构；第三是路由调用层，即在聊天流程返回回复后，尝试把结果转发到 AIRI。这个设计已经足以说明后端桥接方向是存在的，而且不是空壳。

但与此同时，前端目录检索没有发现与 `Live2D`、`VRM`、`Pixi`、`Three` 相关的角色组件、舞台页或资源装载器。现有页面仍然集中在 Chat、Cockpit、Memories、Settings 等通用业务界面。因此，用户的判断应当被修正为一句更精确的话：

> **SmartAgent4 目前并非“没有 AIRI”，而是“已有 AIRI Bridge 后端接入，但缺少浏览器端角色舞台实现”。**

这一区分非常重要。因为它意味着下一步不是从零做全链路，而是补足“最后一段”——也就是浏览器中的可视化舞台模块。

## 五、建议在 SmartAgent4 中单独建立的模块结构

考虑到用户明确希望“在 SmartAgent4 中单独建一个文件夹模块放 AIRI 相关代码”，这个方向是合理的，而且有利于把 AIRI 相关逻辑与现有 Cockpit 主界面边界分离。建议采用如下目录结构。

| 建议目录 | 作用 | 备注 |
| --- | --- | --- |
| `client/src/modules/airi-stage/` | React 侧 AIRI 舞台入口模块 | 作为 SmartAgent4 主前端中的一个独立功能域 |
| `client/src/modules/airi-stage/components/` | 舞台容器、控制栏、状态面板 | React 包装层 |
| `client/src/modules/airi-stage/runtime/` | 与 AIRI 复用代码交互的适配层 | 负责桥接 React 与复用模块 |
| `client/src/modules/airi-stage/assets/` | 默认角色资源、占位背景、配置 | 先支持本地静态资源 |
| `vendor/airi-stage-live2d/` | 从 AIRI 抽取并裁剪的 Live2D 子模块 | 建议作为 vendored code 管理 |
| `server/airi-bridge/` | 保持现有后端桥接层 | 继续负责消息转发与协议适配 |

如果从可维护性出发，我更推荐把复用来的 AIRI 代码放在 **`vendor/airi-stage-live2d/`** 或 **`client/vendor/airi-stage-live2d/`** 这类目录，而不是直接散落进现有业务组件树。原因很简单：这样可以清晰标明它是“基于 AIRI 裁剪的外部模块”，以后做升级、替换或二次同步时会更容易管理。

## 六、方案 C 的最小可运行集成路径

如果目标是尽快得到一个能展示、能联动、能演示的版本，那么最小集成路径应该聚焦于 **2D 角色舞台预览**，暂时不追求完整的 AIRI Stage Web 功能复刻。

第一步，是在 SmartAgent4 前端新增一个独立的 AiriStage 页面或 Cockpit 侧边面板，并预留一个固定尺寸的舞台容器。此时不需要先引入复杂业务逻辑，只要保证角色层能独立挂载、销毁和重渲染即可。

第二步，是从 AIRI 的 `packages/stage-ui-live2d` 中抽取最关键的运行时能力，包括模型加载、表情切换、动作触发、预览与资源读取逻辑，并在 SmartAgent4 内部包上一层 React 适配器。这里的核心不是“把 Vue 页面跑起来”，而是“把其中真正与 Live2D 舞台运行相关的逻辑抽出来”。

第三步，是将 SmartAgent4 现有 `server/airi-bridge/` 输出的情感、文本和音频事件整理成统一前端事件流，例如 `expressionChanged`、`motionTriggered`、`ttsStarted`、`ttsEnded`。然后由前端舞台模块消费这些事件，驱动角色做出基础动作与表情变化。

第四步，是先采用本地静态资源方式完成角色加载。也就是说，第一版先只支持一个默认 Live2D 角色和少量情感映射，不在第一阶段引入复杂的在线资源管理、角色商城、云端同步或完整配置中心。这样可以最快落地演示能力。

第五步，等方案 C 跑通后，再决定是否向上兼容更多 AIRI 生态能力，例如接入 `packages/stage-ui` 的更多状态组织方式，或进一步并入 `packages/stage-ui-three` 支持 VRM/3D 角色。

## 七、工作量估算与风险判断

如果采用“整体搬运 `apps/stage-web`”思路，预计会遇到 Vue/React 双栈并存、样式系统并存、状态管理耦合和构建链路复杂化等问题，因此首阶段工作量不会低，风险也偏高。相反，如果采用“抽取 Live2D 子模块 + React 适配壳 + 接现有 AIRI Bridge 事件流”的方式，工作量会明显可控。

| 路线 | 预估工作量 | 主要风险 | 综合判断 |
| --- | --- | --- | --- |
| 整体搬运 AIRI Stage Web | 6–10 人日 | 框架耦合高、边界不清、后续维护复杂 | 不建议首阶段采用 |
| 抽取 Live2D 子模块做方案 C | 2–4 人日 | 需要做 React 适配与情感事件映射 | **推荐** |
| 继续扩展到 VRM/3D | 再增加 3–6 人日 | 资源体积、渲染复杂度、性能调优 | 适合作为第二阶段 |

这里的估算建立在一个前提上：**不追求把 AIRI 的完整 Web 生态原样搬进 SmartAgent4，而只追求“可展示、可联动、可演示”的最小舞台版本。**在这个前提下，用户所说“也许即便是方案 C，代价也不大”是成立的。

## 八、最终答复

综合来看，本次补充调研后的正式答复如下。

第一，**是的，AIRI 开源仓库已经调研过，而且它确实包含可直接复用的大量 Web 展示相关代码**。尤其是 `packages/stage-ui-live2d`、`packages/stage-ui-three`、`packages/stage-ui` 和 `apps/stage-web`，都能为 SmartAgent4 提供现成的角色舞台能力来源 [3] [4] [5]。但最合理的复用方式不是把 AIRI 整个 Web 应用搬进来，而是在 SmartAgent4 中新建一个独立的 AIRI 舞台模块，以“裁剪复用渲染层”的方式接入。这样既能显著降低成本，也能避免框架耦合失控。

第二，**你的现状理解基本准确**。SmartAgent4 当前已经有 AIRI 接口桥接和消息转发能力，但与 AIRI 在浏览器端的角色展示相关的代码基本没有。更准确地说，是“后端桥接已有，前端舞台几乎空缺”。

第三，如果你认可这一路线，下一步完全可以直接进入实现阶段：在 SmartAgent4 中新增 `airi-stage` 独立子模块，先做一个能加载默认 Live2D 角色、能接收情感事件、能在 Cockpit 中显示的前端原型。这样做与当前方案 C 高度一致，而且工程边界清晰、迭代风险较低。

## References

[1]: https://github.com/moeru-ai/airi "Project AIRI - GitHub"
[2]: https://raw.githubusercontent.com/moeru-ai/airi/main/README.md "Project AIRI README"
[3]: https://raw.githubusercontent.com/moeru-ai/airi/main/AGENTS.md "Project AIRI AGENTS.md"
[4]: https://raw.githubusercontent.com/moeru-ai/airi/main/packages/stage-ui-live2d/package.json "AIRI stage-ui-live2d package.json"
[5]: https://raw.githubusercontent.com/moeru-ai/airi/main/packages/stage-ui-three/package.json "AIRI stage-ui-three package.json"
