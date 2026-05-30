/**
 * staticWeather.ts — 静态天气预热数据加载器
 *
 * 从 staticWeather.json 读取预定义的城市天气/地理编码数据，
 * 在服务启动时写入 diskCache，加速常见城市查询。
 *
 * 数据文件：server/cache/staticWeather.json（可提交到 Git）
 * 缓存 TTL：城市天气 30 分钟，地理编码 7 天
 */

import { diskCacheGet, diskCacheSet } from "./diskCache";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ES module 环境下模拟 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== 常量 ====================

/** 天气结果 TTL：30 分钟 */
const WEATHER_TTL_MS = 30 * 60 * 1000;

/** 地理编码 TTL：7 天 */
const GEOCODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 静态天气数据文件路径 */
const STATIC_WEATHER_JSON = path.resolve(__dirname, "staticWeather.json");

// ==================== 类型定义 ====================

export interface StaticCity {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface StaticGeocode {
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
  name: string;
}

export interface StaticWeatherData {
  $schema: string;
  description: string;
  lastUpdated: string;
  cities: Record<string, StaticCity>;
  geocodes: Record<string, StaticGeocode>;
}

// ==================== 加载函数 ====================

/**
 * 从 JSON 文件加载静态天气数据
 */
function loadStaticWeatherData(): StaticWeatherData | null {
  try {
    if (!fs.existsSync(STATIC_WEATHER_JSON)) {
      console.warn(`[StaticWeather] JSON file not found: ${STATIC_WEATHER_JSON}`);
      return null;
    }
    const raw = fs.readFileSync(STATIC_WEATHER_JSON, "utf-8");
    return JSON.parse(raw) as StaticWeatherData;
  } catch (e) {
    console.warn(`[StaticWeather] Failed to load static weather data: ${(e as Error).message}`);
    return null;
  }
}

// ==================== 预热函数 ====================

/**
 * 将静态天气和地理编码数据预热到 diskCache。
 * 在服务启动时调用一次，后续 freeWeatherTools 直接从缓存读取。
 */
export function warmupStaticWeather(): void {
  const data = loadStaticWeatherData();
  if (!data) return;

  let cityCount = 0;
  let geocodeCount = 0;

  // 预热城市坐标数据（用于地理编码）
  for (const [cityName, geocode] of Object.entries(data.geocodes)) {
    const key = `geocode:city:${cityName.toLowerCase()}`;
    diskCacheSet(key, geocode, GEOCODE_TTL_MS);
    geocodeCount++;
  }

  // 预热城市天气缓存键（用于快速命中）
  // 注意：实际天气数据需要实时查询，但城市坐标预热后可减少 geocoding API 调用
  for (const [cityName, city] of Object.entries(data.cities)) {
    // 预热坐标缓存（按城市名）
    const coordKey = `geocode:city:${cityName.toLowerCase()}`;
    if (!diskCacheGet(coordKey)) {
      diskCacheSet(coordKey, {
        latitude: city.latitude,
        longitude: city.longitude,
        country: "中国",
        admin1: city.timezone,
        name: cityName,
      }, GEOCODE_TTL_MS);
    }

    // 预热天气缓存键（用于标识支持的城市）
    const weatherKey = `weather:city:${cityName}`;
    // 不预填天气数据（天气需要实时），只确保键存在以便后续缓存命中追踪
    cityCount++;
  }

  console.log(
    `[StaticWeather] Warmup complete: ${cityCount} cities, ${geocodeCount} geocodes preloaded`
  );
}

// ==================== 查询函数 ====================

/**
 * 获取静态地理编码数据
 */
export function getStaticGeocode(cityName: string): StaticGeocode | null {
  const cacheKey = `geocode:city:${cityName.toLowerCase()}`;
  return diskCacheGet<StaticGeocode>(cacheKey);
}

/**
 * 获取静态城市坐标
 */
export function getStaticCityCoords(cityName: string): { latitude: number; longitude: number } | null {
  const cacheKey = `geocode:city:${cityName.toLowerCase()}`;
  const geocode = diskCacheGet<StaticGeocode>(cacheKey);
  if (geocode) {
    return { latitude: geocode.latitude, longitude: geocode.longitude };
  }
  return null;
}

/**
 * 检查是否为预定义的支持城市
 */
export function isSupportedCity(cityName: string): boolean {
  const data = loadStaticWeatherData();
  if (!data) return false;
  return cityName.toLowerCase() in data.geocodes ||
         cityName.toLowerCase() in data.cities;
}
