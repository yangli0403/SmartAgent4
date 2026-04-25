/**
 * Itinerary Tools — 行程规划工具集
 *
 * 提供 generate_itinerary 内置工具，结合目的地、日期和偏好
 * 生成包含时间节点、路线、耗时预估的完整行程单。
 * 当前为 Mock 实现，返回预设的行程数据，确保 Demo 演示稳定性。
 *
 * 注册方式：内置工具（builtin），与 freeWeatherTools / memoryTools 模式一致。
 */
import type { ToolRegistry } from "../../mcp/toolRegistry";

// ==================== 常量 ====================

/** 内置行程工具的 serverId */
export const ITINERARY_TOOLS_SERVER_ID = "builtin-itinerary-tools";

// ==================== 数据类型 ====================

/** 活动类型 */
export type ActivityType = "transit" | "dining" | "sightseeing" | "accommodation" | "other";

/** 单个行程节点 */
export interface ItineraryStop {
  id: string;
  time: string;
  location: string;
  activity: string;
  duration: number;
  type: ActivityType;
}

/** 完整行程数据 */
export interface ItineraryData {
  destination: string;
  date: string;
  stops: ItineraryStop[];
  totalDuration: number;
}

// ==================== Mock 行程模板 ====================

/** 按目的地生成 Mock 行程 */
function generateMockItinerary(
  destination: string,
  date: string,
  preferences?: string
): ItineraryData {
  // 基础行程模板（以上海为例，其他城市也使用类似结构）
  const hasFoodPreference =
    preferences &&
    /美食|吃|餐|火锅|小吃|川菜|日料|海鲜/.test(preferences);

  const hasNaturePreference =
    preferences && /自然|风光|公园|湖|山|海/.test(preferences);

  const stops: ItineraryStop[] = [
    {
      id: "stop_1",
      time: `${date} 08:00`,
      location: `${destination}出发点`,
      activity: `从酒店出发，前往${destination}市中心`,
      duration: 30,
      type: "transit",
    },
    {
      id: "stop_2",
      time: `${date} 08:30`,
      location: destination === "上海" ? "外滩" : `${destination}地标景点`,
      activity: hasNaturePreference
        ? `游览${destination}自然风光`
        : `参观${destination}标志性景点`,
      duration: 90,
      type: "sightseeing",
    },
    {
      id: "stop_3",
      time: `${date} 10:00`,
      location: destination === "上海" ? "南京路步行街" : `${destination}商业街`,
      activity: "逛街购物，感受当地文化氛围",
      duration: 60,
      type: "sightseeing",
    },
    {
      id: "stop_4",
      time: `${date} 11:00`,
      location: destination === "上海" ? "城隍庙" : `${destination}美食街`,
      activity: hasFoodPreference
        ? `品尝${destination}特色美食，推荐当地招牌菜`
        : `午餐时间，品尝${destination}当地特色小吃`,
      duration: 90,
      type: "dining",
    },
    {
      id: "stop_5",
      time: `${date} 12:30`,
      location: destination === "上海" ? "陆家嘴" : `${destination}现代区`,
      activity: `游览${destination}现代化地标`,
      duration: 120,
      type: "sightseeing",
    },
    {
      id: "stop_6",
      time: `${date} 14:30`,
      location: destination === "上海" ? "豫园" : `${destination}历史文化区`,
      activity: `探索${destination}历史文化底蕴`,
      duration: 90,
      type: "sightseeing",
    },
    {
      id: "stop_7",
      time: `${date} 16:00`,
      location: destination === "上海" ? "新天地" : `${destination}休闲区`,
      activity: "下午茶休息，享受悠闲时光",
      duration: 60,
      type: "dining",
    },
    {
      id: "stop_8",
      time: `${date} 17:00`,
      location: destination === "上海" ? "外滩观景台" : `${destination}观景点`,
      activity: `欣赏${destination}夜景，拍照留念`,
      duration: 60,
      type: "sightseeing",
    },
    {
      id: "stop_9",
      time: `${date} 18:00`,
      location: destination === "上海" ? "浦东滨江大道" : `${destination}晚餐地点`,
      activity: `晚餐，享用${destination}特色晚餐`,
      duration: 90,
      type: "dining",
    },
  ];

  const totalDuration = stops.reduce((sum, s) => sum + s.duration, 0);

  return {
    destination,
    date,
    stops,
    totalDuration,
  };
}

// ==================== 工具实现 ====================

/**
 * generate_itinerary — 生成行程规划
 *
 * @param args 工具参数
 * @returns 行程数据的 JSON 字符串
 */
export function generateItineraryImpl(args: Record<string, unknown>): string {
  const destination = args.destination as string | undefined;
  const preferences = args.preferences as string | undefined;

  // 参数校验
  if (!destination || destination.trim().length === 0) {
    return JSON.stringify({
      success: false,
      error: "destination 参数不能为空，请指定目的地",
    });
  }

  // 日期处理：默认为明天
  let date = args.date as string | undefined;
  if (!date) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    date = tomorrow.toISOString().split("T")[0];
  }

  const itinerary = generateMockItinerary(destination.trim(), date, preferences);

  return JSON.stringify({
    success: true,
    itinerary,
  });
}

// ==================== 注册函数 ====================

/**
 * 将行程规划工具注册到 ToolRegistry
 */
export function registerItineraryTools(registry: ToolRegistry): void {
  registry.register({
    name: "generate_itinerary",
    description:
      "生成完整的行程规划。根据目的地、日期和用户偏好，生成包含时间节点、地点、活动和耗时预估的详细行程单。",
    inputSchema: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description: "目的地城市或区域，如 '上海'、'北京'、'杭州西湖'",
        },
        date: {
          type: "string",
          description: "行程日期，格式 YYYY-MM-DD，默认为明天",
        },
        preferences: {
          type: "string",
          description: "用户偏好，如 '美食'、'自然风光'、'紧凑'、'宽松'",
        },
      },
      required: ["destination"],
    },
    serverId: ITINERARY_TOOLS_SERVER_ID,
    category: "navigation",
    registeredAt: new Date(),
  });
}

/**
 * 调用行程规划工具（供 ToolRegistry 的 callTool 使用）
 */
export async function callItineraryTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  if (toolName === "generate_itinerary") {
    return generateItineraryImpl(args);
  }
  return JSON.stringify({ error: `未知的行程工具: ${toolName}` });
}
