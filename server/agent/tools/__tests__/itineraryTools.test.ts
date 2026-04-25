/**
 * Itinerary Tools 单元测试
 *
 * 测试 generate_itinerary 工具的参数校验、行程生成和返回结构。
 * 关联用户测试用例：UTC-B4-1 ~ UTC-B4-7
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateItineraryImpl,
  registerItineraryTools,
  callItineraryTool,
  ITINERARY_TOOLS_SERVER_ID,
} from "../itineraryTools";

// ==================== Mock ToolRegistry ====================
const mockRegister = vi.fn();
const mockToolRegistry = {
  register: mockRegister,
};

// ==================== 测试 ====================
describe("ItineraryTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== registerItineraryTools ====================
  describe("registerItineraryTools", () => {
    it("应注册 1 个行程工具到 ToolRegistry", () => {
      registerItineraryTools(mockToolRegistry as any);
      expect(mockRegister).toHaveBeenCalledTimes(1);
    });

    it("注册的工具名称应为 generate_itinerary", () => {
      registerItineraryTools(mockToolRegistry as any);
      const registeredName = mockRegister.mock.calls[0][0].name;
      expect(registeredName).toBe("generate_itinerary");
    });

    it("工具的 serverId 应为 ITINERARY_TOOLS_SERVER_ID", () => {
      registerItineraryTools(mockToolRegistry as any);
      expect(mockRegister.mock.calls[0][0].serverId).toBe(ITINERARY_TOOLS_SERVER_ID);
    });

    it("工具应有 inputSchema 定义且 destination 为必填", () => {
      registerItineraryTools(mockToolRegistry as any);
      const schema = mockRegister.mock.calls[0][0].inputSchema;
      expect(schema).toBeDefined();
      expect(schema.type).toBe("object");
      expect(schema.properties.destination).toBeDefined();
      expect(schema.required).toContain("destination");
    });
  });

  // ==================== generateItineraryImpl ====================
  describe("generateItineraryImpl", () => {
    // UTC-B4-1: generate_itinerary({ destination: "上海" }) 返回包含至少 3 个 stops 的行程
    it("指定目的地应返回包含至少 3 个 stops 的行程", () => {
      const result = JSON.parse(generateItineraryImpl({ destination: "上海" }));
      expect(result.success).toBe(true);
      expect(result.itinerary).toBeDefined();
      expect(result.itinerary.stops.length).toBeGreaterThanOrEqual(3);
    });

    // UTC-B4-2: 每个 stop 包含 time、location、activity、duration 字段
    it("每个 stop 应包含 time/location/activity/duration 字段", () => {
      const result = JSON.parse(generateItineraryImpl({ destination: "上海" }));
      for (const stop of result.itinerary.stops) {
        expect(stop).toHaveProperty("time");
        expect(stop).toHaveProperty("location");
        expect(stop).toHaveProperty("activity");
        expect(stop).toHaveProperty("duration");
        expect(typeof stop.time).toBe("string");
        expect(typeof stop.location).toBe("string");
        expect(typeof stop.activity).toBe("string");
        expect(typeof stop.duration).toBe("number");
      }
    });

    // UTC-B4-3: 指定日期后 stops 的 time 均在指定日期
    it("指定日期后 stops 的 time 应包含指定日期", () => {
      const result = JSON.parse(
        generateItineraryImpl({ destination: "上海", date: "2026-04-26" })
      );
      for (const stop of result.itinerary.stops) {
        expect(stop.time).toContain("2026-04-26");
      }
    });

    // UTC-B4-4: 指定美食偏好后至少一个 stop 包含餐饮相关内容
    it("指定美食偏好后至少一个 stop 的 activity 包含餐饮相关内容", () => {
      const result = JSON.parse(
        generateItineraryImpl({ destination: "上海", preferences: "美食" })
      );
      const hasDining = result.itinerary.stops.some(
        (s: any) => s.type === "dining" || /美食|特色|招牌菜|小吃|餐/.test(s.activity)
      );
      expect(hasDining).toBe(true);
    });

    // UTC-B4-5: 缺少 destination 参数时返回错误
    it("缺少 destination 参数应返回校验错误", () => {
      const result = JSON.parse(generateItineraryImpl({}));
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("destination");
    });

    it("destination 为空字符串应返回校验错误", () => {
      const result = JSON.parse(generateItineraryImpl({ destination: "  " }));
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    // UTC-B4-7: 返回的行程对象包含顶层 destination 和 date 字段
    it("返回的行程对象应包含顶层 destination 和 date 字段", () => {
      const result = JSON.parse(generateItineraryImpl({ destination: "上海" }));
      expect(result.itinerary.destination).toBe("上海");
      expect(result.itinerary.date).toBeDefined();
      expect(typeof result.itinerary.date).toBe("string");
    });

    it("未指定日期时应默认为明天", () => {
      const result = JSON.parse(generateItineraryImpl({ destination: "北京" }));
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const expectedDate = tomorrow.toISOString().split("T")[0];
      expect(result.itinerary.date).toBe(expectedDate);
    });

    it("行程应包含 totalDuration 字段", () => {
      const result = JSON.parse(generateItineraryImpl({ destination: "上海" }));
      expect(result.itinerary.totalDuration).toBeDefined();
      expect(typeof result.itinerary.totalDuration).toBe("number");
      expect(result.itinerary.totalDuration).toBeGreaterThan(0);
    });
  });

  // ==================== callItineraryTool ====================
  describe("callItineraryTool", () => {
    it("调用 generate_itinerary 应返回有效 JSON", async () => {
      const result = await callItineraryTool("generate_itinerary", {
        destination: "上海",
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(true);
    });

    it("调用未知工具应返回错误", async () => {
      const result = await callItineraryTool("unknown_tool", {});
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });
  });
});
