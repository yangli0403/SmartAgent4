# SmartAgent4 迭代计划 (0403)

## 1. 迭代目标概述

本次迭代（0403版本）旨在从**功能扩展**和**架构演进**两个维度对 SmartAgent4 进行深度升级。

- **功能扩展**：引入"C盘维护专家"能力，将现有的 `FileAgent` 从基础的文件整理工具升级为专业的系统存储管家。
- **架构演进**：实现 Agent 的完全动态加载（Fully Dynamic Loading），彻底消除核心管线中的硬编码，实现真正的"零代码修改热插拔"。

---

## 2. 功能扩展：C盘维护专家

在 SmartAgent4 中实现"C盘维护专家"是完全可行且具有极高实用价值的。经过评估，我们决定**不创建独立的 Agent，而是将 C 盘维护能力作为高级技能扩展到现有的 `FileAgent` 中**。

### 2.1 现有能力复用
当前的 `FileAgent` 已经具备了强大的目录分析、重复文件检测和安全删除能力。现有的 `analyze_directory`、`find_duplicates` 和 `delete_files` 工具已经覆盖了约 60% 的 C 盘清理需求。

### 2.2 新增工具开发计划
为了填补系统级清理的缺口，计划在 `server/mcp/fileOrganizerTools.ts` 中新增以下三个 MCP 工具：

| 新增工具 | 核心功能 | 技术实现路径 |
| :--- | :--- | :--- |
| `get_disk_health` | 获取 C 盘总容量、已用空间和剩余空间比例，评估健康度。 | Node.js 调用 `wmic logicaldisk` 或 PowerShell `Get-PSDrive` [1]。 |
| `scan_system_junk` | 扫描系统临时文件（`%TEMP%`）、浏览器缓存及开发者冗余目录。 | 预设白名单目录递归扫描 [2]。 |
| `execute_advanced_cleanup` | 执行 Windows 原生深度清理（如 WinSxS 组件存储）。 | 封装 PowerShell 脚本（`cleanmgr` / `dism.exe`），需 UAC 提权 [3]。 |

### 2.3 安全沙箱改造
现有的 `isPathSafe()` 函数严格限制只能操作用户主目录（`~`）。在本次迭代中，需将其升级为**白名单模式**，明确允许对 `C:\Windows\Temp` 等特定系统临时目录进行安全操作，同时继续拦截对核心系统目录的写请求。

---

## 3. 架构演进：完全动态加载

当前系统处于"半动态"状态，虽然 Agent Card 已经实现了 JSON 配置驱动，但在 `smartAgentApp.ts` 和 `classifyNode.ts` 中仍存在类实例化和降级路由的硬编码。本次迭代将彻底消除这些痛点。

### 3.1 消除实例化硬编码
**痛点**：`smartAgentApp.ts` 中使用静态 `import` 和 `new` 关键字创建 Agent 实例，新增 Agent 必须修改核心代码。

**改造方案**：采用"配置驱动 + 动态导入 + 反射工厂"模式。重写 `createAndBindAgents` 方法，使用 Node.js 原生动态导入（`import()`）或 Vite 的 `import.meta.glob` 机制 [4]。

```typescript
// 改造后的动态工厂伪代码
async createAndBindAgents(): Promise<void> {
  const cards = this.agentCardRegistry.getAllEnabled();
  for (const card of cards) {
    const modulePath = `./domains/${card.id}.js`; 
    const module = await import(modulePath);
    const AgentClass = module.default || module[card.implementationClass];
    const agentInstance = new AgentClass(this.mcpManager);
    this.agentCardRegistry.bindAgent(card.id, agentInstance);
  }
}
```

### 3.2 消除领域与路由硬编码
**痛点**：`AgentDomain` 是封闭的联合类型，且 `classifyNode.ts` 中的 `domainToAgents()` 函数硬编码了领域到 Agent ID 的映射。

**改造方案**：
1. **开放 Domain 类型**：将 `AgentDomain` 改为开放字符串类型 `"file_system" | "navigation" | ... | (string & {})`，保留代码提示的同时允许自定义领域。
2. **动态化降级路由**：重写 `domainToAgents` 函数，改为查询注册表 `AgentCardRegistry.findByDomain(domain)`，动态获取该领域下优先级最高的 Agent。

### 3.3 预期收益
改造完成后，开发者只需将 `newAgent.ts` 和 `newAgent.json` 放入对应目录，重启服务，系统即可自动发现、实例化并将其纳入 Supervisor 的调度管线，真正实现 AI Agent 系统的插件化。

---

## 4. 迭代风险与缓解策略

| 风险点 | 影响 | 缓解策略 |
| :--- | :--- | :--- |
| **系统级清理误删** | C 盘深度清理可能导致系统不稳定。 | 严格执行分级清理策略，高风险操作（如 WinSxS 清理）必须在 System Prompt 中强制要求用户二次确认。 |
| **动态导入类型丢失** | 动态导入返回 `any`，编译期无法检查构造函数签名。 | 强制所有 Agent 实现 `DomainAgentInterface`，在实例化后进行运行时类型断言（Duck Typing）。 |
| **构建工具兼容性** | 打包工具可能无法静态分析动态 `import()`。 | 在打包配置中显式包含 `domains/` 目录，或使用 `import.meta.glob` 替代纯变量导入 [5]。 |

---

## 参考文献
[1] Windows Command line get disk space in GB. SuperUser.
[2] Clean up old node_modules in Windows 10. KatieKodes.
[3] How to Analyze the Component Store (WinSxS Folder) in Windows 10. NinjaOne.
[4] Dynamically loading a typescript class. StackOverflow.
[5] Glob Import. Vite Documentation.
