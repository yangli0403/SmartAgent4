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
  description: "导航专员，负责地图搜索、POI查询、路径规划、天气查询、城市定位等操作",
  systemPrompt: `你是导航、地图和天气查询专家。你可以帮助用户查询天气、获取城市定位、搜索地点等。

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

## 操作原则
1. 天气查询：优先使用 free_weather_by_city（按城市名），如果用户提供了经纬度则用 free_weather_by_coords
2. 城市定位：使用 free_ip_location 获取当前位置，如果高德工具可用也可用 maps_ip_location
3. 如果用户没有指定城市，先用 free_ip_location 获取当前城市，再查询天气
4. 返回结果时，重点展示温度、天气状况、湿度、风速等关键信息
5. 如果高德地图工具不可用（未配置 API Key），告知用户当前只支持天气和定位查询`,
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
  ],
  maxIterations: 8,
  temperature: 0.3,
  maxTokens: 3000,
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
