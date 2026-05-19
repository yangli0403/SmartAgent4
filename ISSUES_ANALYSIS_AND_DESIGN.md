# SmartAgent4 核心体验问题分析与方案设计

## 问题一：记忆去重逻辑失效，为何同类偏好出现两遍？

### 原因分析
通过排查 `memoryExtractionNode.ts` 和 `confidenceEvolution.ts`，我们发现问题出在**人格记忆（persona kind）被排除了动态演化机制**。

1. 当 LLM 从对话中提取出“我是贵州人，我喜欢吃辣的，我喜欢喝拿铁咖啡”时，系统调用 `persistExplicitPreferenceMemory`。
2. 该函数生成的 `versionGroup` 是基于内容哈希的（例如 `explicit_preference_...`），且记忆类型 `kind` 被硬编码为 `persona`。
3. 在底层的去重与置信度演化逻辑 `evolveConfidence` 中（`confidenceEvolution.ts` 第 168 行），存在一条规则：**`if (newMemory.kind === "persona") return { action: "SKIP" }`**。
4. 这导致人格类偏好跳过了基于 `versionGroup` 的内容一致性检查（Jaccard 相似度匹配）和 `BOOST/SUPERSEDE` 更新机制，每次提取到相似内容都会被当作新条目直接插入数据库，最终导致前端列表中出现重复数据。

### 方案设计
**修改 `confidenceEvolution.ts` 中的过滤规则：**
放宽对 `persona` 类型的限制，或者更精细地处理。由于 `preference`（偏好）也属于 `persona`，但偏好是需要去重的，我们可以：
1. 在 `evolveConfidence` 中，仅跳过纯身份信息（如 `type === "identity"`），而允许 `type === "preference"` 的记忆参与基于 `versionGroup` 的演化。
2. 或在 `memoryExtractionNode.ts` 中，改进 `versionGroup` 的生成逻辑，使其基于“偏好主体”（如“饮食偏好”、“咖啡偏好”）而不是全文哈希，并在演化时允许 `persona` 类型进行 `SUPERSEDE`（覆盖）操作。

---

## 问题二：主动推荐仍未触发（空调24度，关大灯，放白噪音）

### 原因分析
尽管我们在 `parallelExecuteEngine.ts` 中补齐了对 `recordDeterministicActionPatterns` 的调用，但**意图分类层（classifyNode.ts）将该指令误判为了多媒体域（multimedia）**，导致后续车控工具未被调用，从而无法触发行为记录。

1. 用户指令：“空调24度，关大灯，放白噪音”。
2. `classifyNode.ts` 中的启发式规则检测到“白噪音”关键词，匹配了 `multimedia` 域特征（`if (/歌曲|歌手|专辑|播放|音乐|歌单|歌词/.test(aiText))` 甚至底层的音乐复合任务规则）。
3. 任务被路由给 `multimediaAgent`，而 `multimediaAgent.json` 中配置的工具仅限于音乐搜索播放（`search`, `get_song_detail` 等），**没有车控工具**。
4. 由于没有实际调用车控工具，`recordDeterministicActionPatterns` 中的 `inferSceneDomain` 无法识别出 `vehicle_control` 域，导致行为模式未被记录，频率未增加，自然无法触发 3 次后的主动推荐。

### 方案设计
**优化意图分类与跨域处理：**
1. **分类规则修正**：在 `classifyNode.ts` 中增加针对“车控组合指令”的强规则。当输入同时包含车控（空调、大灯）和多媒体（白噪音）时，应优先分类为 `cross_domain` 或 `vehicle_control`（白噪音可视为车内环境控制的一部分）。
2. **行为推断兜底**：在 `deterministicBehaviorAggregator.ts` 的 `inferTextOnlyVehicleActions` 中，虽然已经能解析文本中的车控指令，但前提是必须被正确路由。因此核心仍在于修正分类路由，确保车控指令被分配给具备相应能力的 Agent（或在 `cross_domain` 下由 Supervisor 拆解给多个 Agent 执行）。

---

## 问题三：导航路线别名记忆（“记为送同事A回家”）的架构可行性

### 需求回顾
用户希望实现：“从软件园开始，去苏州北站，途径苏州站，请把这个导航路线记为送同事A回家”。下次直接说“送同事A回家”即可导航。

### 架构可行性分析
**目前的架构完全可以支持，且基础设施已经就绪（SceneEpisode 机制）。**

1. **底层支持**：我们在 `sceneEpisode.ts` 中已经实现了统一的场景记忆结构，支持 `domain: "navigation"`、`sceneName: "送同事A回家"`，并能保存 `navOrigin`, `navDestination`, `navWaypoints` 以及 `actions`（包含 `maps_direction_driving` 工具调用参数）。
2. **当前触发机制**：目前 `persistNavigationEpisodic.ts` 是一种“兜底隐式记忆”，它会自动将最近一次成功的导航记为“通勤路线”等默认名称，缺乏用户显式命名的能力。
3. **缺失的环节**：系统目前缺少对用户**“显式命名指令”（“请把这个路线记为...”）**的意图识别和工具调用。

### 方案设计
**新增 `save_navigation_scene` 工具：**
1. 在 `navigationAgent` 中新增一个工具 `save_navigation_scene`，参数包括 `sceneName`（场景名称，如“送同事A回家”）、`origin`、`destination`、`waypoints`。
2. 当 LLM 识别到用户有“记为/保存为”的意图时，调用该工具。
3. 工具内部调用 `persistSceneEpisode`，将路线信息和触发短语（如 `["送同事A回家", "去同事A家"]`）保存到数据库。
4. **召回执行**：当用户下次说“送同事A回家”时，`contextEnrichNode` 会通过混合检索命中该 SceneEpisode。Agent 读取到该记忆后，提取其中的坐标/地点参数，直接调用 `maps_direction_driving` 进行导航规划。

---

## 问题四：旅游行程规划耗时分析与缓存方案

### 耗时瓶颈分析
通过阅读 `itineraryTools.ts` 中的 `generateRealItinerary` 函数，我们发现行程规划是一个**高度串行且重度依赖外部 API** 的过程，主要耗时点如下：
1. **POI 批量搜索（并发但耗时）**：使用 `Promise.allSettled` 并发搜索景点、餐厅、酒店、早餐店，虽然是并发，但仍受限于最慢的一个请求（高德 API 响应时间）。
2. **路径规划（严重串行）**：在构建每日行程的循环中，每一次地点转移（如酒店到早餐、早餐到景点、景点到午餐）都**实时 `await amapDrivingDuration(currentLocation, nextLocation)`**。
   - 假设 3 天行程，每天约 8 次地点转移，总计需发起 **24 次串行的路径规划 API 请求**。
   - 每次请求约耗时 200-500ms，仅这一部分就会导致 5-12 秒的绝对阻塞延迟。

### 缓存与优化方案设计
目前的架构中有一个 `prefetchCache.ts`，但它是用于缓存**记忆检索上下文**的，不能直接用于行程规划 API。我们需要在工具层实现专门的缓存与并发优化。

1. **距离/耗时矩阵缓存（内存级 LRU）**：
   - 在 `itineraryTools.ts` 中引入一个简单的 LRU 缓存，键为 `${origin}|${destination}`，值为 `TransitResult`。
   - 同一城市内的热门景点之间、酒店与景点之间的距离，在短时间内是固定的，缓存命中率会很高。
2. **预计算与并发请求改造**：
   - 在构建每日行程之前，先提取出所有可能需要的地点坐标集合。
   - 并发发起一批核心地点的距离测算（或在循环中尽可能提前发起不依赖前置结果的请求）。
3. **降低精度换取速度（降级策略）**：
   - 对于行程规划这种粗粒度的计划，其实不需要每次都调用高精度的 `direction/driving` 接口。
   - 可以改用高德的**距离测量 API（distance）**进行批量测算（一次请求可测算多个起终点），或者根据直线距离粗略估算耗时（例如市区内按 30km/h 估算），仅在用户明确要求精确导航时才调用真实规划接口。
