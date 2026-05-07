/**
 * NavigationAgent — 导航专员
 *
 * 负责处理地图搜索、POI 查询、路径规划、导航等任务。
 * 内置免费天气/定位工具（无需 API Key），可选高德地图 MCP 工具。
 * 内部运行 LangGraph ReACT 循环（继承 BaseAgent）。
 */

import { BaseAgent } from "./baseAgent";
import type {
  DomainAgentConfig,
  AgentStructuredData,
  NavigationData,
  POIItem,
} from "./types";
import type { MCPManager } from "../../mcp/mcpManager";

/** NavigationAgent 默认配置 */
export const NAVIGATION_AGENT_CONFIG: DomainAgentConfig = {
  name: "navigationAgent",
  description: "导航专员，负责地图搜索、POI查询、路径规划、天气查询、城市定位、行程规划等操作",
  systemPrompt: `你是导航、地图、天气查询和行程规划专家。你可以帮助用户查询天气、获取城市定位、搜索地点、规划行程等。

## 可用工具说明

### 免费内置工具（始终可用，无需 API Key）
- free_weather_by_city: 按城市名查询天气，支持中英文城市名（如：北京、上海、Beijing）
- free_weather_by_coords: 按经纬度查询天气
- free_ip_location: 通过 IP 获取当前城市定位（无需参数）
- free_geocode_city: 城市名转经纬度坐标

### 高德地图工具（需要 API Key 配置后才可用）
- maps_around_search: 周边搜索
- maps_text_search: 关键词搜索
- maps_direction_driving: 驾车路径规划
- maps_direction_walking: 步行路径规划
- maps_direction_transit_integrated: 公交/地铁路径规划
- maps_direction_bicycling: 骑行路径规划
- maps_geo: 地址转经纬度
- maps_regeocode: 经纬度转地址
- maps_weather: 天气查询（高德版）
- maps_ip_location: IP定位（高德版）
- maps_distance: 距离测量
- maps_search_detail: 查询POI详细信息

### 行程规划工具（核心能力）
- generate_itinerary: 生成精确到分钟的完整行程规划，自动调用高德地图API获取真实景点和交通耗时

## 行程规划（最高优先级）
当用户要求制定旅行/出行/旅游行程时，**必须**使用 generate_itinerary 工具，**严禁**自己编造行程：

1. **提取参数**：从用户输入中提取目的地(destination)、天数(days)、起床时间(wake_up_time)、睡觉时间(sleep_time)、偏好(preferences)
2. **天数推断**：如果用户没有明确说天数，根据上下文推断：
   - "周末" = 2天
   - "一日游" = 1天
   - "三天两夜" = 3天
   - 默认 = 1天
3. **作息时间**：如果用户提到了作息习惯，必须传入对应参数：
   - "不太早起" / "7点半起" → wake_up_time: "07:30"
   - "8点起" → wake_up_time: "08:00"
   - "11点睡" → sleep_time: "23:00"
   - "10点睡" → sleep_time: "22:00"
   - 默认: wake_up_time="07:30", sleep_time="23:00"
4. **偏好提取**：用户提到的兴趣关键词传入 preferences 参数：
   - "喜欢自然风光" → preferences: "自然风光"
   - "想吃当地美食" → preferences: "美食"
   - "带小孩" → preferences: "亲子"
5. **展示结果**：将工具返回的 formattedText 字段**完整展示**给用户，这是一个包含精确时间、地点、交通信息的完整表格
6. **严禁编造**：所有时间点、地点、交通耗时必须来自 generate_itinerary 工具的返回结果，不要自己编写行程

## 操作原则
1. 天气查询：**必须使用 free_weather_by_city 工具**，严禁凭空捏造温度、天气状况等数据！
2. 城市定位：使用 free_ip_location 获取当前位置，如果高德工具可用也可用 maps_ip_location
3. 如果用户没有指定城市，先用 free_ip_location 获取当前城市，再查询天气
4. 返回结果时，重点展示温度、天气状况、湿度、风速等关键信息
5. 如果高德地图工具不可用（未配置 API Key），告知用户当前只支持天气和定位查询

## ⚠️ 重要警告：禁止凭空编造天气数据！
- 你没有真实的天气信息访问权限，**绝对不能**直接告诉用户某个城市的温度或天气
- **必须先调用 free_weather_by_city 工具**，等待工具返回真实数据后再回复用户
- 任何时候都不要用"我记得"、"可能是"、"大概"等推测性语言描述天气
- 如果工具调用失败或返回错误，诚实地告知用户"天气查询服务暂时不可用"

## 路线与 POI 检索（多轮对话必守）
1. 若用户在**同一会话**或**最近对话上下文**中已说明起点、终点或城市（例如公司、家、区名），则视为信息已足够，**不要**再泛泛索要「具体地址」；应直接调用 maps_geo / maps_direction_* 等工具规划或检索。
2. 用户说「途经 / 途径 / 顺路去」某 POI 时，该 POI 必须与**当前路线所在城市一致**：从最近对话中的起点/终点或「用户当前位置」中的城市推断区域，调用 maps_text_search、maps_around_search 时**必须**带上该城市/区域（或先用 maps_geo 锚定城市中心再搜），**禁止**在无城市约束下全国检索导致结果落到其他城市（如北京、香港等）。
3. 关键词搜索时优先使用「城市名 + POI 名」组合（例如「苏州 山姆」），与路线上下文矛盾的结果应丢弃并重搜。`,
  toolNames: [
    // 免费内置工具（始终可用）
    "free_weather_by_city",       // 按城市名查天气
    "free_weather_by_coords",     // 按经纬度查天气
    "free_ip_location",           // IP 定位
    "free_geocode_city",          // 城市名转坐标
    // 高德地图 MCP 工具（需要配置 API Key）
    "maps_around_search",         // 周边搜索
    "maps_text_search",           // 关键词搜索
    "maps_direction_driving",     // 驾车路径规划
    "maps_direction_walking",     // 步行路径规划
    "maps_direction_transit_integrated", // 公交路径规划
    "maps_direction_bicycling",   // 骑行路径规划
    "maps_geo",                   // 地址转经纬度
    "maps_regeocode",             // 经纬度转地址
    "maps_weather",               // 天气查询（高德）
    "maps_ip_location",           // IP 定位（高德）
    "maps_distance",              // 距离测量
    "maps_search_detail",         // POI 详情
    "maps_schema_personal_map",   // 行程规划展示
    "maps_schema_navi",           // 唤起导航
    "maps_schema_take_taxi",      // 唤起打车
    // 行程规划内置工具
    "generate_itinerary",         // 行程规划
  ],
  maxIterations: 8,
  temperature: 0.3,
  maxTokens: 4000,
};

/**
 * NavigationAgent 实现
 */
export class NavigationAgent extends BaseAgent {
  readonly name = NAVIGATION_AGENT_CONFIG.name;
  readonly description = NAVIGATION_AGENT_CONFIG.description;
  readonly availableTools: string[];

  constructor(mcpManager: MCPManager, config?: Partial<DomainAgentConfig>) {
    const mergedConfig = { ...NAVIGATION_AGENT_CONFIG, ...config };
    super(mergedConfig, mcpManager);
    // 只保留 ToolRegistry 中实际存在的工具（过滤掉未连接的高德工具）
    this.availableTools = mergedConfig.toolNames;
  }

  /**
   * 获取系统提示词（注入用户位置和时间上下文）
   */
  getSystemPrompt(context?: Record<string, unknown>): string {
    let prompt = this.config.systemPrompt;

    if (context?.location) {
      const loc = context.location as {
        latitude: number;
        longitude: number;
        city?: string;
      };
      prompt += `\n\n用户当前位置: 经度 ${loc.longitude}, 纬度 ${loc.latitude}`;
      if (loc.city) {
        prompt += `, 城市: ${loc.city}`;
      }
    }

    if (context?.currentTime) {
      prompt += `\n当前时间: ${context.currentTime}`;
    }

    if (context?.dialogueSlots) {
      prompt +=
        `\n会话槽位（城市/起终点/途经点）已注入任务消息；POI 与路径检索须与槽位一致，勿改用其他城市。`;
    }

    return prompt;
  }

  /**
   * 解析导航类结构化数据
   *
   * 尝试从 LLM 输出中提取 POI 列表、路径信息等。
   */
  protected parseStructuredData(output: string): AgentStructuredData | undefined {
    try {
      // 尝试从输出中提取 JSON 数据
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        if (data.pois || data.route) {
          return {
            type: "navigation",
            pois: data.pois,
            route: data.route,
            center: data.center,
          } as NavigationData;
        }
      }
    } catch {
      // 解析失败，不返回结构化数据
    }

    return undefined;
  }
}
