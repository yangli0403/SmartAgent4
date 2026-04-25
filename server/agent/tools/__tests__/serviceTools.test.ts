/**
 * Service Tools 单元测试
 *
 * 测试 search_restaurants 和 place_order 工具的参数校验、过滤和返回结构。
 * 关联用户测试用例：UTC-B3-1 ~ UTC-B3-9
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchRestaurantsImpl,
  placeOrderImpl,
  registerServiceTools,
  callServiceTool,
  SERVICE_TOOLS_SERVER_ID,
} from "../serviceTools";

// ==================== Mock ToolRegistry ====================
const mockRegister = vi.fn();
const mockToolRegistry = {
  register: mockRegister,
};

// ==================== 测试 ====================
describe("ServiceTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== registerServiceTools ====================
  describe("registerServiceTools", () => {
    it("应注册 2 个生活服务工具到 ToolRegistry", () => {
      registerServiceTools(mockToolRegistry as any);
      expect(mockRegister).toHaveBeenCalledTimes(2);
    });

    it("注册的工具名称应为 search_restaurants 和 place_order", () => {
      registerServiceTools(mockToolRegistry as any);
      const registeredNames = mockRegister.mock.calls.map(
        (call: any[]) => call[0].name
      );
      expect(registeredNames).toContain("search_restaurants");
      expect(registeredNames).toContain("place_order");
    });

    it("所有工具的 serverId 应为 SERVICE_TOOLS_SERVER_ID", () => {
      registerServiceTools(mockToolRegistry as any);
      for (const call of mockRegister.mock.calls) {
        expect(call[0].serverId).toBe(SERVICE_TOOLS_SERVER_ID);
      }
    });

    it("place_order 的 inputSchema 应要求 restaurantId 和 items 为必填", () => {
      registerServiceTools(mockToolRegistry as any);
      const placeOrderCall = mockRegister.mock.calls.find(
        (call: any[]) => call[0].name === "place_order"
      );
      expect(placeOrderCall).toBeDefined();
      const schema = placeOrderCall![0].inputSchema;
      expect(schema.required).toContain("restaurantId");
      expect(schema.required).toContain("items");
    });
  });

  // ==================== search_restaurants ====================
  describe("searchRestaurantsImpl", () => {
    // UTC-B3-1: 无参数调用返回默认餐厅列表（至少 3 家）
    it("无参数调用应返回默认餐厅列表（至少 3 家）", () => {
      const result = JSON.parse(searchRestaurantsImpl({}));
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(3);
      expect(result.restaurants.length).toBeGreaterThanOrEqual(3);
    });

    // UTC-B3-2: 按菜系过滤，每项 cuisine 字段包含"川菜"
    it("按 cuisine='川菜' 过滤应返回川菜餐厅", () => {
      const result = JSON.parse(searchRestaurantsImpl({ cuisine: "川菜" }));
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
      for (const r of result.restaurants) {
        expect(r.cuisine).toContain("川菜");
      }
    });

    // UTC-B3-3: 按位置过滤
    it("按 location='陆家嘴' 过滤应返回陆家嘴区域餐厅", () => {
      const result = JSON.parse(searchRestaurantsImpl({ location: "陆家嘴" }));
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
      for (const r of result.restaurants) {
        expect(r.location).toContain("陆家嘴");
      }
    });

    it("每个餐厅应包含完整字段", () => {
      const result = JSON.parse(searchRestaurantsImpl({}));
      for (const r of result.restaurants) {
        expect(r).toHaveProperty("id");
        expect(r).toHaveProperty("name");
        expect(r).toHaveProperty("cuisine");
        expect(r).toHaveProperty("rating");
        expect(r).toHaveProperty("pricePerPerson");
        expect(r).toHaveProperty("location");
        expect(r).toHaveProperty("distance");
      }
    });

    it("按 maxPrice 过滤应返回价格在范围内的餐厅", () => {
      const result = JSON.parse(searchRestaurantsImpl({ maxPrice: 70 }));
      expect(result.success).toBe(true);
      for (const r of result.restaurants) {
        expect(r.pricePerPerson).toBeLessThanOrEqual(70);
      }
    });
  });

  // ==================== place_order ====================
  describe("placeOrderImpl", () => {
    // UTC-B3-4: 返回包含 orderId、estimatedTime、status 的确认对象
    it("正常下单应返回包含 orderId/estimatedTime/status 的确认", () => {
      const result = JSON.parse(
        placeOrderImpl({
          restaurantId: "rest_001",
          items: ["宫保鸡丁", "麻婆豆腐"],
        })
      );
      expect(result.success).toBe(true);
      expect(result.order).toBeDefined();
      expect(result.order.orderId).toBeDefined();
      expect(typeof result.order.orderId).toBe("string");
      expect(result.order.estimatedTime).toBeDefined();
      expect(result.order.status).toBe("confirmed");
      expect(result.order.restaurantName).toBeDefined();
      expect(result.order.items).toEqual(["宫保鸡丁", "麻婆豆腐"]);
      expect(result.order.totalPrice).toBeGreaterThan(0);
    });

    // UTC-B3-5: 缺少 restaurantId 参数时抛出校验错误
    it("缺少 restaurantId 应返回校验错误", () => {
      const result = JSON.parse(
        placeOrderImpl({ items: ["宫保鸡丁"] })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("restaurantId");
    });

    // UTC-B3-6: 缺少 items 参数时抛出校验错误
    it("缺少 items 应返回校验错误", () => {
      const result = JSON.parse(
        placeOrderImpl({ restaurantId: "rest_001" })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("items");
    });

    it("items 为空数组应返回校验错误", () => {
      const result = JSON.parse(
        placeOrderImpl({ restaurantId: "rest_001", items: [] })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("items");
    });

    it("restaurantId 为空字符串应返回校验错误", () => {
      const result = JSON.parse(
        placeOrderImpl({ restaurantId: "", items: ["宫保鸡丁"] })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("restaurantId");
    });
  });

  // ==================== callServiceTool ====================
  describe("callServiceTool", () => {
    it("调用 search_restaurants 应返回有效 JSON", async () => {
      const result = await callServiceTool("search_restaurants", {});
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });

    it("调用 place_order 应返回有效 JSON", async () => {
      const result = await callServiceTool("place_order", {
        restaurantId: "rest_001",
        items: ["宫保鸡丁"],
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });

    it("调用未知工具应返回错误", async () => {
      const result = await callServiceTool("unknown_tool", {});
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });
  });
});
