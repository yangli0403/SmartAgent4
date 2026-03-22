/**
 * Free Weather & Location Tools — 免费天气和定位工具
 *
 * 无需注册、无需 API Key 的免费工具集：
 * - free_get_weather: 基于 wttr.in + open-meteo，按城市名或经纬度查询天气
 * - free_ip_location: 基于 ip-api.com，通过 IP 获取城市定位
 * - free_geocode: 基于 open-meteo geocoding，城市名转经纬度
 *
 * 这些工具直接注册到 ToolRegistry，不依赖 MCP Server 连接。
 */

import type { ToolRegistry } from "./toolRegistry";

// ==================== 工具实现 ====================

/**
 * 天气代码转中文描述
 * 基于 WMO Weather interpretation codes (WW)
 */
function weatherCodeToDesc(code: number): string {
  const map: Record<number, string> = {
    0: "晴天",
    1: "大部晴朗",
    2: "局部多云",
    3: "阴天",
    45: "有雾",
    48: "冻雾",
    51: "小毛毛雨",
    53: "中毛毛雨",
    55: "大毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "冰粒",
    80: "小阵雨",
    81: "中阵雨",
    82: "大阵雨",
    85: "小阵雪",
    86: "大阵雪",
    95: "雷暴",
    96: "雷暴伴小冰雹",
    99: "雷暴伴大冰雹",
  };
  return map[code] || "未知天气";
}

/**
 * 查询天气（按城市名）
 * 使用 open-meteo geocoding + forecast API
 */
async function getWeatherByCity(city: string): Promise<string> {
  try {
    // 1. 城市名转经纬度
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
    const geoResp = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
    if (!geoResp.ok) throw new Error(`Geocoding failed: ${geoResp.status}`);
    const geoData = await geoResp.json() as { results?: Array<{ name: string; latitude: number; longitude: number; country: string; admin1?: string }> };

    if (!geoData.results || geoData.results.length === 0) {
      return `未找到城市"${city}"的地理信息，请检查城市名称是否正确。`;
    }

    const location = geoData.results[0];
    const { latitude, longitude, name, country, admin1 } = location;
    const locationName = admin1 ? `${country} ${admin1} ${name}` : `${country} ${name}`;

    // 2. 查询天气
    return await getWeatherByCoords(latitude, longitude, locationName);
  } catch (e) {
    // 降级到 wttr.in
    try {
      const wttrUrl = `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`;
      const wttrResp = await fetch(wttrUrl, { signal: AbortSignal.timeout(8000) });
      if (!wttrResp.ok) throw new Error(`wttr.in failed: ${wttrResp.status}`);
      const data = await wttrResp.json() as {
        current_condition: Array<{
          temp_C: string;
          FeelsLikeC: string;
          humidity: string;
          windspeedKmph: string;
          weatherDesc: Array<{ value: string }>;
        }>;
        nearest_area: Array<{
          areaName: Array<{ value: string }>;
          country: Array<{ value: string }>;
        }>;
        weather: Array<{
          date: string;
          maxtempC: string;
          mintempC: string;
          hourly: Array<{ weatherDesc: Array<{ value: string }> }>;
        }>;
      };

      const cur = data.current_condition[0];
      const area = data.nearest_area[0];
      const cityName = area.areaName[0].value;
      const countryName = area.country[0].value;

      let result = `📍 ${countryName} ${cityName} 当前天气\n`;
      result += `🌡️ 温度: ${cur.temp_C}°C（体感 ${cur.FeelsLikeC}°C）\n`;
      result += `🌤️ 天气: ${cur.weatherDesc[0].value}\n`;
      result += `💧 湿度: ${cur.humidity}%\n`;
      result += `💨 风速: ${cur.windspeedKmph} km/h\n`;

      if (data.weather && data.weather.length > 0) {
        result += `\n📅 近期预报:\n`;
        data.weather.slice(0, 3).forEach((day) => {
          result += `  ${day.date}: ${day.mintempC}°C ~ ${day.maxtempC}°C\n`;
        });
      }

      return result;
    } catch (e2) {
      return `天气查询失败: ${(e as Error).message}`;
    }
  }
}

/**
 * 查询天气（按经纬度）
 * 使用 open-meteo forecast API
 */
async function getWeatherByCoords(
  latitude: number,
  longitude: number,
  locationName?: string
): Promise<string> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=3`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`open-meteo failed: ${resp.status}`);

    const data = await resp.json() as {
      current: {
        time: string;
        temperature_2m: number;
        relative_humidity_2m: number;
        apparent_temperature: number;
        weather_code: number;
        wind_speed_10m: number;
        precipitation: number;
      };
      daily: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_sum: number[];
      };
      timezone: string;
    };

    const cur = data.current;
    const loc = locationName || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;

    let result = `📍 ${loc} 当前天气\n`;
    result += `🌡️ 温度: ${cur.temperature_2m}°C（体感 ${cur.apparent_temperature}°C）\n`;
    result += `🌤️ 天气: ${weatherCodeToDesc(cur.weather_code)}\n`;
    result += `💧 湿度: ${cur.relative_humidity_2m}%\n`;
    result += `💨 风速: ${cur.wind_speed_10m} km/h\n`;
    if (cur.precipitation > 0) {
      result += `🌧️ 降水: ${cur.precipitation} mm\n`;
    }
    result += `🕐 更新时间: ${cur.time}（${data.timezone}）\n`;

    if (data.daily && data.daily.time.length > 0) {
      result += `\n📅 近期预报:\n`;
      data.daily.time.slice(0, 3).forEach((date, i) => {
        result += `  ${date}: ${data.daily.temperature_2m_min[i]}°C ~ ${data.daily.temperature_2m_max[i]}°C，${weatherCodeToDesc(data.daily.weather_code[i])}`;
        if (data.daily.precipitation_sum[i] > 0) {
          result += `，降水 ${data.daily.precipitation_sum[i]} mm`;
        }
        result += `\n`;
      });
    }

    return result;
  } catch (e) {
    return `天气查询失败: ${(e as Error).message}`;
  }
}

/**
 * 通过 IP 获取城市定位
 * 使用 ip-api.com（免费，无需注册）
 */
async function getLocationByIP(ip?: string): Promise<string> {
  try {
    const url = ip
      ? `http://ip-api.com/json/${ip}?fields=status,message,city,regionName,country,lat,lon,timezone&lang=zh-CN`
      : `http://ip-api.com/json/?fields=status,message,city,regionName,country,lat,lon,timezone&lang=zh-CN`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`ip-api.com failed: ${resp.status}`);

    const data = await resp.json() as {
      status: string;
      message?: string;
      city?: string;
      regionName?: string;
      country?: string;
      lat?: number;
      lon?: number;
      timezone?: string;
    };

    if (data.status !== "success") {
      return `IP 定位失败: ${data.message || "未知错误"}`;
    }

    let result = `📍 IP 定位结果\n`;
    result += `🌍 国家/地区: ${data.country}\n`;
    if (data.regionName) result += `🏙️ 省/州: ${data.regionName}\n`;
    if (data.city) result += `🏘️ 城市: ${data.city}\n`;
    if (data.lat && data.lon) result += `📌 坐标: ${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}\n`;
    if (data.timezone) result += `🕐 时区: ${data.timezone}\n`;

    return result;
  } catch (e) {
    return `IP 定位失败: ${(e as Error).message}`;
  }
}

/**
 * 城市名转经纬度（地理编码）
 * 使用 open-meteo geocoding API
 */
async function geocodeCity(city: string): Promise<string> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&language=zh&format=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`Geocoding failed: ${resp.status}`);

    const data = await resp.json() as {
      results?: Array<{
        name: string;
        latitude: number;
        longitude: number;
        country: string;
        admin1?: string;
        admin2?: string;
      }>;
    };

    if (!data.results || data.results.length === 0) {
      return `未找到城市"${city}"的地理信息。`;
    }

    let result = `📍 "${city}" 地理编码结果:\n`;
    data.results.slice(0, 3).forEach((r, i) => {
      const fullName = [r.country, r.admin1, r.admin2, r.name].filter(Boolean).join(" > ");
      result += `${i + 1}. ${fullName}\n   坐标: 纬度 ${r.latitude.toFixed(4)}, 经度 ${r.longitude.toFixed(4)}\n`;
    });

    return result;
  } catch (e) {
    return `地理编码失败: ${(e as Error).message}`;
  }
}

// ==================== 注册到 ToolRegistry ====================

/**
 * 注册所有免费工具到 ToolRegistry
 *
 * 在 SmartAgentApp 初始化时调用此函数。
 */
export function registerFreeWeatherTools(registry: ToolRegistry): void {
  // 1. 天气查询（按城市名）
  registry.register({
    name: "free_weather_by_city",
    description: "按城市名查询当前天气和近期预报。无需 API Key，使用 open-meteo + wttr.in 免费服务。支持中英文城市名。",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，支持中英文，如：北京、上海、Beijing、Shanghai",
        },
      },
      required: ["city"],
    },
    serverId: "builtin-free-weather",
    category: "navigation",
    registeredAt: new Date(),
  });

  // 2. 天气查询（按经纬度）
  registry.register({
    name: "free_weather_by_coords",
    description: "按经纬度查询当前天气和近期预报。无需 API Key，使用 open-meteo 免费服务。",
    inputSchema: {
      type: "object",
      properties: {
        latitude: {
          type: "number",
          description: "纬度，如：39.9042（北京）",
        },
        longitude: {
          type: "number",
          description: "经度，如：116.4074（北京）",
        },
        location_name: {
          type: "string",
          description: "位置名称（可选，用于显示）",
        },
      },
      required: ["latitude", "longitude"],
    },
    serverId: "builtin-free-weather",
    category: "navigation",
    registeredAt: new Date(),
  });

  // 3. IP 定位
  registry.register({
    name: "free_ip_location",
    description: "通过 IP 地址获取城市定位信息。无需 API Key，使用 ip-api.com 免费服务。不传 IP 则查询当前设备的 IP 位置。",
    inputSchema: {
      type: "object",
      properties: {
        ip: {
          type: "string",
          description: "IP 地址（可选）。不填则查询当前设备的 IP 位置。",
        },
      },
      required: [],
    },
    serverId: "builtin-free-weather",
    category: "navigation",
    registeredAt: new Date(),
  });

  // 4. 城市地理编码
  registry.register({
    name: "free_geocode_city",
    description: "将城市名转换为经纬度坐标。无需 API Key，使用 open-meteo geocoding 免费服务。",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，支持中英文",
        },
      },
      required: ["city"],
    },
    serverId: "builtin-free-weather",
    category: "navigation",
    registeredAt: new Date(),
  });

  console.log("[FreeWeatherTools] Registered 4 free weather/location tools");
}

// ==================== 工具调用分发 ====================

/**
 * 调用免费工具
 *
 * 供 MCPManager 的 callTool 方法调用。
 */
export async function callFreeWeatherTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case "free_weather_by_city":
      return getWeatherByCity(args.city as string);

    case "free_weather_by_coords":
      return getWeatherByCoords(
        args.latitude as number,
        args.longitude as number,
        args.location_name as string | undefined
      );

    case "free_ip_location":
      return getLocationByIP(args.ip as string | undefined);

    case "free_geocode_city":
      return geocodeCity(args.city as string);

    default:
      throw new Error(`Unknown free weather tool: ${toolName}`);
  }
}
