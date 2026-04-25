# SmartAgent4 v0.5 第二批迭代 — 接口与数据结构设计

**作者**：Manus AI
**日期**：2026-04-25
**对应阶段**：system-dev v0.8 第 3 阶段
**前置文档**：`ARCHITECTURE_V0.5_BATCH2.md`

---

## 1. 核心数据结构扩展

### 1.1 行程规划数据结构 (Itinerary)

在 `server/agent/domains/types.ts` 中扩展 `AgentStructuredData`，新增 `itinerary` 类型。

```typescript
/** 行程节点活动类型 */
export type ActivityType = "transit" | "dining" | "sightseeing" | "accommodation" | "other";

/** 单个行程节点 */
export interface ItineraryStop {
  /** 节点 ID */
  id: string;
  /** 预计到达/开始时间 (HH:mm) */
  time: string;
  /** 地点名称 */
  location: string;
  /** 活动描述 */
  activity: string;
  /** 预计耗时 (分钟) */
  duration: number;
  /** 活动类型 */
  type: ActivityType;
  /** 经纬度坐标 (可选) */
  coordinates?: {
    longitude: number;
    latitude: number;
  };
}

/** 完整的行程数据结构 */
export interface ItineraryData extends AgentStructuredData {
  type: "itinerary";
  /** 目的地城市 */
  destination: string;
  /** 行程日期 (YYYY-MM-DD) */
  date: string;
  /** 行程节点列表 */
  stops: ItineraryStop[];
  /** 总耗时预估 (分钟) */
  totalDuration?: number;
}
```

### 1.2 订餐服务数据结构 (Service)

在 `server/agent/domains/types.ts` 中扩展 `AgentStructuredData`，新增 `service` 类型。

```typescript
/** 餐厅信息 */
export interface RestaurantInfo {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  pricePerPerson: number;
  location: string;
  distance?: string;
}

/** 订单信息 */
export interface OrderInfo {
  orderId: string;
  restaurantName: string;
  items: string[];
  totalPrice: number;
  status: "pending" | "confirmed" | "delivering" | "completed";
  estimatedTime: string;
}

/** 生活服务数据结构 */
export interface ServiceData extends AgentStructuredData {
  type: "service";
  /** 推荐的餐厅列表 */
  restaurants?: RestaurantInfo[];
  /** 订单详情 (如果是下单操作) */
  order?: OrderInfo;
}
```

---

## 2. API 端点契约

### 2.1 Omni Token 接口 (REST)

**端点**: `GET /api/omni/token`
**鉴权**: 需要登录 (复用现有鉴权中间件)
**描述**: 获取 DashScope Qwen-Omni-Realtime 的临时 Token 和 WebSocket 连接地址。

**响应格式 (200 OK)**:
```json
{
  "token": "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  "expireTime": "2026-04-25T12:00:00Z",
  "wsUrl": "wss://dashscope.aliyuncs.com/api-ws/v1/inference/"
}
```

**错误响应 (503 Service Unavailable)**:
```json
{
  "error": "DashScope API Key not configured"
}
```

---

## 3. 工具 (Tools) 接口契约

### 3.1 新闻工具 (`newsTools.ts`)

```typescript
import { z } from "zod";

export const getLatestNewsSchema = z.object({
  category: z.enum(["general", "tech", "business", "sports", "entertainment", "ai"]).optional()
    .describe("新闻分类，默认为 general"),
  count: z.number().min(1).max(10).optional()
    .describe("返回的新闻条数，默认为 5")
});

export type GetLatestNewsInput = z.infer<typeof getLatestNewsSchema>;

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string;
}
```

### 3.2 行程规划工具 (`itineraryTools.ts`)

```typescript
import { z } from "zod";

export const generateItinerarySchema = z.object({
  destination: z.string().describe("目的地城市或区域，如 '上海'、'浦东新区'"),
  date: z.string().optional().describe("行程日期，格式 YYYY-MM-DD，默认为明天"),
  preferences: z.string().optional().describe("用户偏好，如 '美食'、'自然风光'、'紧凑'、'宽松'"),
  startLocation: z.string().optional().describe("出发地，如果不填则默认从酒店或市中心出发")
});

export type GenerateItineraryInput = z.infer<typeof generateItinerarySchema>;
// 返回类型为 ItineraryData 中的 stops 数组
```

### 3.3 生活服务工具 (`serviceTools.ts`)

```typescript
import { z } from "zod";

export const searchRestaurantsSchema = z.object({
  cuisine: z.string().optional().describe("菜系或口味，如 '川菜'、'日料'、'清淡'"),
  location: z.string().optional().describe("目标区域，如 '陆家嘴'、'当前位置'"),
  maxPrice: z.number().optional().describe("人均最高价格")
});

export const placeOrderSchema = z.object({
  restaurantId: z.string().describe("餐厅 ID"),
  items: z.array(z.string()).describe("菜品名称列表"),
  deliveryAddress: z.string().optional().describe("配送地址，默认为当前位置")
});
```

---

## 4. Agent Card 配置契约

### 4.1 OfficeAgent (`officeAgent.json`)

```json
{
  "id": "officeAgent",
  "name": "办公协同专员",
  "description": "处理飞书建群、发送消息、日程安排等办公协同任务",
  "capabilities": [
    "im_chat_create",
    "im_message_send",
    "calendar_manage"
  ],
  "tools": [
    "lark_im_create_chat",
    "lark_im_send_message"
  ],
  "domain": "office",
  "implementationClass": "OfficeAgent",
  "llmConfig": {
    "temperature": 0.1,
    "maxTokens": 2000,
    "maxIterations": 5
  },
  "systemPromptTemplate": "你是一个办公协同专员。你的职责是帮助用户在飞书等办公软件中进行沟通和协作。\n\n【重要防御性指示】：当你的任务是发送行程通知，且上下文中存在前置导航专员（navigationAgent）生成的行程规划结果时，你**必须**提取该行程的摘要信息作为消息正文发送，绝不能只发一句空洞的“行程已规划”。",
  "enabled": true,
  "priority": 40
}
```

### 4.2 ServiceAgent (`serviceAgent.json`)

```json
{
  "id": "serviceAgent",
  "name": "生活服务专员",
  "description": "处理餐厅推荐、外卖预订等生活服务任务，结合用户口味偏好提供个性化建议",
  "capabilities": [
    "restaurant_recommendation",
    "food_delivery"
  ],
  "tools": [
    "memory_search",
    "search_restaurants",
    "place_order"
  ],
  "domain": "service",
  "implementationClass": "ServiceAgent",
  "llmConfig": {
    "temperature": 0.5,
    "maxTokens": 2000,
    "maxIterations": 6
  },
  "systemPromptTemplate": "你是一个生活服务专员。你的职责是为用户提供餐饮推荐和外卖预订服务。\n\n【操作原则】：\n1. 在推荐餐厅前，必须先调用 memory_search 工具查询用户的口味偏好和饮食禁忌。\n2. 推荐时要说明为什么推荐这家餐厅（结合用户偏好）。\n3. 确认订单前必须向用户复述菜品和总价。",
  "enabled": true,
  "priority": 45
}
```

---

## 5. 前端组件契约

### 5.1 OmniRealtimeClient

```typescript
export interface OmniClientEvents {
  onTextDelta?: (text: string) => void;
  onAudioDelta?: (pcmData: Int16Array) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: "idle" | "connecting" | "connected" | "listening" | "speaking") => void;
}

export class OmniRealtimeClient {
  constructor(events: OmniClientEvents);
  async connect(token: string, wsUrl: string): Promise<void>;
  sendAudio(pcmData: Int16Array): void;
  disconnect(): void;
}
```

### 5.2 ItineraryTimeline 组件 Props

```typescript
import type { ItineraryStop } from "../../../shared/types"; // 假设类型已移至 shared

export interface ItineraryTimelineProps {
  /** 目的地 */
  destination: string;
  /** 行程日期 */
  date?: string;
  /** 行程节点列表 */
  stops: ItineraryStop[];
  /** 自定义类名 */
  className?: string;
}
```
