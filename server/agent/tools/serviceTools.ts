/**
 * Service Tools — 生活服务工具集
 *
 * 提供 search_restaurants 和 place_order 两个内置工具，
 * 支持餐厅搜索和外卖下单功能。
 * 当前为 Mock 实现，返回预设数据，确保 Demo 演示稳定性。
 *
 * 注册方式：内置工具（builtin），与 freeWeatherTools / memoryTools 模式一致。
 */
import type { ToolRegistry } from "../../mcp/toolRegistry";

// ==================== 常量 ====================

/** 内置生活服务工具的 serverId */
export const SERVICE_TOOLS_SERVER_ID = "builtin-service-tools";

// ==================== 数据类型 ====================

/** 餐厅信息 */
export interface RestaurantInfo {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  pricePerPerson: number;
  location: string;
  distance: string;
  openHours: string;
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

// ==================== Mock 数据 ====================

const MOCK_RESTAURANTS: RestaurantInfo[] = [
  {
    id: "rest_001",
    name: "川味坊",
    cuisine: "川菜",
    rating: 4.7,
    pricePerPerson: 68,
    location: "陆家嘴金融中心 B1",
    distance: "1.2km",
    openHours: "10:00-22:00",
  },
  {
    id: "rest_002",
    name: "鼎泰丰",
    cuisine: "上海菜",
    rating: 4.8,
    pricePerPerson: 120,
    location: "陆家嘴正大广场 6F",
    distance: "0.8km",
    openHours: "11:00-21:30",
  },
  {
    id: "rest_003",
    name: "一兰拉面",
    cuisine: "日料",
    rating: 4.5,
    pricePerPerson: 85,
    location: "南京东路步行街",
    distance: "2.5km",
    openHours: "11:00-23:00",
  },
  {
    id: "rest_004",
    name: "海底捞火锅",
    cuisine: "川菜",
    rating: 4.6,
    pricePerPerson: 130,
    location: "浦东新区世纪大道",
    distance: "1.8km",
    openHours: "10:00-次日06:00",
  },
  {
    id: "rest_005",
    name: "外婆家",
    cuisine: "浙菜",
    rating: 4.4,
    pricePerPerson: 55,
    location: "徐家汇美罗城 4F",
    distance: "5.2km",
    openHours: "10:30-21:00",
  },
  {
    id: "rest_006",
    name: "全聚德",
    cuisine: "北京菜",
    rating: 4.3,
    pricePerPerson: 150,
    location: "南京西路商圈",
    distance: "3.1km",
    openHours: "11:00-21:30",
  },
  {
    id: "rest_007",
    name: "绿茶餐厅",
    cuisine: "浙菜",
    rating: 4.5,
    pricePerPerson: 65,
    location: "陆家嘴环球金融中心",
    distance: "0.5km",
    openHours: "10:00-22:00",
  },
];

// ==================== 工具实现 ====================

/**
 * search_restaurants — 搜索餐厅
 *
 * @param args 工具参数
 * @returns 餐厅列表的 JSON 字符串
 */
export function searchRestaurantsImpl(args: Record<string, unknown>): string {
  const cuisine = args.cuisine as string | undefined;
  const location = args.location as string | undefined;
  const maxPrice = args.maxPrice as number | undefined;

  let filtered = [...MOCK_RESTAURANTS];

  // 按菜系过滤
  if (cuisine) {
    filtered = filtered.filter((r) =>
      r.cuisine.includes(cuisine) || r.name.includes(cuisine)
    );
  }

  // 按位置过滤
  if (location) {
    filtered = filtered.filter((r) => r.location.includes(location));
  }

  // 按价格过滤
  if (maxPrice && maxPrice > 0) {
    filtered = filtered.filter((r) => r.pricePerPerson <= maxPrice);
  }

  return JSON.stringify({
    success: true,
    count: filtered.length,
    restaurants: filtered,
  });
}

/**
 * place_order — 下单
 *
 * @param args 工具参数
 * @returns 订单确认的 JSON 字符串
 */
export function placeOrderImpl(args: Record<string, unknown>): string {
  const restaurantId = args.restaurantId as string | undefined;
  const items = args.items as string[] | undefined;

  // 参数校验
  if (!restaurantId || restaurantId.trim().length === 0) {
    return JSON.stringify({
      success: false,
      error: "restaurantId 参数不能为空，请指定餐厅 ID",
    });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return JSON.stringify({
      success: false,
      error: "items 参数不能为空，请指定至少一个菜品",
    });
  }

  // 查找餐厅
  const restaurant = MOCK_RESTAURANTS.find((r) => r.id === restaurantId);
  const restaurantName = restaurant ? restaurant.name : "未知餐厅";

  // 生成 Mock 订单
  const order: OrderInfo = {
    orderId: `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    restaurantName,
    items,
    totalPrice: items.length * 35 + Math.floor(Math.random() * 50),
    status: "confirmed",
    estimatedTime: "约 30-45 分钟",
  };

  return JSON.stringify({
    success: true,
    order,
  });
}

// ==================== 注册函数 ====================

/**
 * 将生活服务工具注册到 ToolRegistry
 */
export function registerServiceTools(registry: ToolRegistry): void {
  // 1. 餐厅搜索
  registry.register({
    name: "search_restaurants",
    description:
      "搜索附近的餐厅。支持按菜系、位置和价格筛选。返回餐厅名称、评分、人均价格、距离等信息。",
    inputSchema: {
      type: "object",
      properties: {
        cuisine: {
          type: "string",
          description: "菜系或口味，如 '川菜'、'日料'、'浙菜'",
        },
        location: {
          type: "string",
          description: "目标区域，如 '陆家嘴'、'南京路'",
        },
        maxPrice: {
          type: "number",
          description: "人均最高价格（元）",
        },
      },
      required: [],
    },
    serverId: SERVICE_TOOLS_SERVER_ID,
    category: "service",
    registeredAt: new Date(),
  });

  // 2. 外卖下单
  registry.register({
    name: "place_order",
    description:
      "在指定餐厅下单外卖。需要提供餐厅 ID 和菜品列表。返回订单号、预计送达时间等信息。",
    inputSchema: {
      type: "object",
      properties: {
        restaurantId: {
          type: "string",
          description: "餐厅 ID（来自 search_restaurants 的返回结果）",
        },
        items: {
          type: "array",
          items: { type: "string" },
          description: "菜品名称列表，如 ['宫保鸡丁', '麻婆豆腐', '米饭']",
        },
        deliveryAddress: {
          type: "string",
          description: "配送地址（可选，默认为当前位置）",
        },
      },
      required: ["restaurantId", "items"],
    },
    serverId: SERVICE_TOOLS_SERVER_ID,
    category: "service",
    registeredAt: new Date(),
  });
}

/**
 * 调用生活服务工具（供 ToolRegistry 的 callTool 使用）
 */
export async function callServiceTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case "search_restaurants":
      return searchRestaurantsImpl(args);
    case "place_order":
      return placeOrderImpl(args);
    default:
      return JSON.stringify({ error: `未知的生活服务工具: ${toolName}` });
  }
}
