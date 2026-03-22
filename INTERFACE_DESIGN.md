# SmartAgent4 接口与数据结构设计

**文档状态**：第3阶段产出
**目标**：定义 SmartAgent4 中三大新增功能（SmartMem、Emotions-System、文件整理大师）的数据模型、服务接口和 MCP 工具契约。

## 1. 记忆系统 (SmartMem) 数据结构与接口

### 1.1 数据库 Schema 扩展 (`server/db.ts` 或 `schema.ts`)

在现有的 `memories` 表基础上，新增向量、时效和重要性字段。

```typescript
// 伪代码表示 Drizzle Schema 扩展
export const memories = sqliteTable("memories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  type: text("type").notNull(), // fact, behavior, preference, emotion
  kind: text("kind").notNull().default("episodic"), // episodic, semantic, persona
  versionGroup: text("version_group"),
  
  // --- 新增字段 ---
  embedding: text("embedding", { mode: "json" }), // 存储向量数组的 JSON 字符串
  importance: real("importance").default(1.0), // 记忆重要性分数 (0.0 - 1.0)
  validFrom: integer("valid_from", { mode: "timestamp" }), // 生效时间
  validUntil: integer("valid_until", { mode: "timestamp" }), // 失效时间
  lastAccessedAt: integer("last_accessed_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  accessCount: integer("access_count").default(0),
  
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});
```

### 1.2 记忆服务接口 (`server/memory/memorySystem.ts`)

```typescript
export interface SearchMemoriesOptions {
  userId: number;
  query?: string;
  type?: string;
  kind?: string;
  limit?: number;
  // 新增混合检索参数
  useHybridSearch?: boolean; 
  alpha?: number; // BM25 与 Vector 的权重调节 (0-1)
}

// 记忆巩固服务接口
export interface ConsolidationService {
  consolidateMemories(userId: number): Promise<void>;
}

// 动态遗忘服务接口
export interface ForgettingService {
  applyDecay(userId: number): Promise<void>;
}
```

## 2. 情感与语音系统接口

### 2.1 EmotionsSystemClient (`server/emotions/emotionsClient.ts`)

```typescript
export interface TTSRequest {
  text: string;
  emotion?: string; // 如 "happy", "sad"
  instruction?: string; // 额外的语音指令
  voiceId?: string; // 音色 ID
}

export interface TTSResponse {
  audioBase64: string; // WAV 格式的 Base64 编码
  format: string; // "wav"
}

export class EmotionsSystemClient {
  /**
   * 解析形如 "[emotion:happy|instruction:用欢快的语气] 文本内容" 的字符串
   */
  parseEmotionTags(text: string): { cleanText: string; tags: Record<string, string> };
  
  /**
   * 调用外部 Emotions-System 微服务获取音频
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse>;
}
```

## 3. 文件整理大师 MCP 工具契约

在 `server/mcp/fileSystemTools.ts` 中新增以下工具定义：

### 3.1 `analyze_directory` (目录分析)
*   **描述**：扫描指定目录，返回按文件类型、大小区间的统计汇总，以及大文件和旧文件列表。
*   **参数**：
    *   `directory` (string): 目标目录路径。
    *   `topLargeFiles` (number, optional): 返回最大的 N 个文件，默认 10。
    *   `olderThanDays` (number, optional): 查找超过 N 天未修改的文件，默认 30。
*   **返回**：包含 `statistics` (按类型/大小统计)、`largeFiles`、`oldFiles` 的 JSON 对象。

### 3.2 `find_duplicates` (同名与重复文件检测)
*   **描述**：扫描指定目录，找出同名文件和完全重复（基于大小和哈希）的文件。
*   **参数**：
    *   `directory` (string): 目标目录路径。
    *   `matchType` (string, optional): "name" (仅同名), "hash" (完全重复), "both" (默认)。
*   **返回**：包含 `sameNameGroups` (同名文件组) 和 `exactDuplicateGroups` (完全重复文件组) 的 JSON 对象。

### 3.3 `delete_files` (安全删除)
*   **描述**：删除指定的文件列表。**注意：Agent 必须在调用此工具前向用户展示列表并获取明确确认。**
*   **参数**：
    *   `filePaths` (string[]): 要删除的文件绝对路径列表。
    *   `moveToTrash` (boolean, optional): 是否移入系统回收站，默认 true。
*   **返回**：包含 `successCount`、`failedCount` 和 `errors` 的结果对象。

### 3.4 `move_files` (移动/归档)
*   **描述**：将多个文件移动到指定目录。
*   **参数**：
    *   `sourcePaths` (string[]): 源文件路径列表。
    *   `destinationDir` (string): 目标目录路径。
*   **返回**：移动结果状态。

## 4. 任务路由扩展 (`server/agent/tasks/index.ts`)

扩展 `detectTaskType` 函数，识别文件整理意图：

```typescript
// 伪代码
if (/整理|清理|重复|同名|汇总|分析.*目录|分析.*下载/.test(input)) {
  return "file_organizer"; // 新增任务类型，或复用 cross_domain 并注入特定 plan
}
```
