/**
 * Itinerary Tools — 行程规划工具集（v2.0 — 真实数据版）
 *
 * 提供 generate_itinerary 内置工具，调用高德地图 REST API：
 *   1. 地理编码（geocode）获取目的地坐标
 *   2. POI 搜索获取真实景点、餐厅、酒店
 *   3. 路径规划（driving/transit）获取真实交通耗时
 *
 * 支持个性化作息（起床/睡觉时间）、多日行程、偏好筛选。
 */
import type { ToolRegistry } from "../../mcp/toolRegistry";
import https from "node:https";
import {
  diskCacheGet,
  diskCacheSet,
  initDiskCache,
  GEOCODE_TTL_MS,
  POI_TTL_MS,
} from "../../cache/diskCache";
import { warmupStaticPois, getGeocodeKey, getPoiKey } from "../../cache/staticPois";

// 启动时初始化磁盘缓存并预热静态 POI 数据
initDiskCache();
warmupStaticPois();

// ==================== 常量 ====================

export const ITINERARY_TOOLS_SERVER_ID = "builtin-itinerary-tools";

const AMAP_BASE = "https://restapi.amap.com/v3";

/**
 * 使用 node:https 模块发起 GET 请求，绕过 undici 全局 dispatcher 的连接池问题。
 * 在服务进程中，MCP SSE 长连接可能占用 undici 连接池导致 ECONNRESET。
 *
 * 抗抖动重试：对 ECONNRESET / timeout / TLS 握手失败自动重试一次，
 * 避免 generate_itinerary 等批量调用被单次网络波动拖到几百秒。
 */
function httpsGetOnce(url: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`JSON parse failed: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
  });
}

function httpsGet(url: string): Promise<any> {
  return httpsGetOnce(url, 10000).catch(async (err: any) => {
    const msg = String(err?.message || err);
    const code = err?.code;
    const retryable =
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "EAI_AGAIN" ||
      /timeout|socket disconnected|ECONNRESET|TLS/i.test(msg);
    if (!retryable) throw err;
    console.warn(`[ItineraryTools] httpsGet retry once due to: ${msg}`);
    await new Promise((r) => setTimeout(r, 400));
    return httpsGetOnce(url, 8000);
  });
}

function getAmapKey(): string {
  return process.env.AMAP_API_KEY || "";
}

// ==================== 数据类型 ====================

export type ActivityType =
  | "wake_up"
  | "breakfast"
  | "transit"
  | "sightseeing"
  | "lunch"
  | "dinner"
  | "accommodation"
  | "rest"
  | "other";

export interface ItineraryStop {
  id: string;
  timeStart: string;   // "HH:mm"
  timeEnd: string;      // "HH:mm"
  location: string;
  address: string;
  activity: string;
  durationMin: number;
  type: ActivityType;
  transitInfo?: string; // 交通方式和耗时说明
  lng?: string;
  lat?: string;
}

export interface ItineraryDay {
  day: number;
  date: string;
  stops: ItineraryStop[];
}

export interface ItineraryData {
  destination: string;
  days: ItineraryDay[];
  totalDays: number;
  wakeUpTime: string;
  sleepTime: string;
  summary: string;
}

// ==================== 高德 API 调用 ====================

interface AmapPOI {
  name: string;
  address: string;
  location: string; // "lng,lat"
  type: string;
  rating?: string;
  biz_ext?: { rating?: string; cost?: string; opentime2?: string };
}

async function amapGeocode(address: string, city?: string): Promise<{ lng: string; lat: string; city: string } | null> {
  // 先查磁盘缓存（静态预热 + 历史请求结果）
  const geoCacheKey = getGeocodeKey(address);
  const cachedGeo = diskCacheGet<{ lng: string; lat: string; city: string }>(geoCacheKey);
  if (cachedGeo) {
    console.log(`[ItineraryTools] Geocode cache HIT: ${address}`);
    return cachedGeo;
  }
  const key = getAmapKey();
  console.log(`[ItineraryTools] Geocode: address=${address}, key=${key ? 'present' : 'MISSING'}`);
  if (!key) return null;
  const params = new URLSearchParams({ key, address });
  if (city) params.set("city", city);
  const url = `${AMAP_BASE}/geocode/geo?${params}`;
  try {
    const data = await httpsGet(url);
    console.log(`[ItineraryTools] Geocode result: status=${data.status}, count=${data.geocodes?.length}`);
    if (data.status === "1" && data.geocodes?.length > 0) {
      const g = data.geocodes[0];
      const [lng, lat] = g.location.split(",");
      const geoResult = { lng, lat, city: g.city || city || "" };
      // 写入磁盘缓存（7天TTL）
      diskCacheSet(geoCacheKey, geoResult, GEOCODE_TTL_MS);
      return geoResult;
    }
  } catch (e: any) {
    console.error(`[ItineraryTools] Geocode failed: ${e.message}`, e.cause ? `cause: ${JSON.stringify(e.cause)}` : "");
  }
  return null;
}

async function amapPOISearch(
  keywords: string,
  city: string,
  types?: string,
  offset: number = 5
): Promise<AmapPOI[]> {
  // 先查磁盘缓存
  const poiCacheKey = `poi_text:${city}:${keywords}:${types || ""}:${offset}`;
  const cachedPois = diskCacheGet<AmapPOI[]>(poiCacheKey);
  if (cachedPois) {
    console.log(`[ItineraryTools] POI search cache HIT: ${city}/${keywords}`);
    return cachedPois;
  }
  // 查静态预热数据（按城市+类型匹配）
  const staticPoiKey = getPoiKey(city, keywords);
  const staticPois = diskCacheGet<AmapPOI[]>(staticPoiKey);
  if (staticPois) {
    console.log(`[ItineraryTools] POI static cache HIT: ${staticPoiKey}`);
    return staticPois;
  }
  const key = getAmapKey();
  if (!key) {
    console.error("[ItineraryTools] AMAP_API_KEY not found in env");
    return [];
  }
  const params = new URLSearchParams({ key, keywords, city, offset: String(offset), extensions: "all" });
  if (types) params.set("types", types);
  const url = `${AMAP_BASE}/place/text?${params}`;
  console.log(`[ItineraryTools] POI search URL: ${url.substring(0, 120)}...`);
  try {
    const data = await httpsGet(url);
    console.log(`[ItineraryTools] POI search result: status=${data.status}, count=${data.count}`);
    if (data.status === "1" && data.pois?.length > 0) {
      const pois = data.pois.map((p: any) => ({
        name: p.name,
        address: typeof p.address === "string" ? p.address : "",
        location: p.location,
        type: p.type || "",
        rating: p.biz_ext?.rating,
        biz_ext: p.biz_ext,
      }));
      // 写入磁盘缓存（6小时TTL）
      diskCacheSet(poiCacheKey, pois, POI_TTL_MS);
      return pois;
    }
  } catch (e: any) {
    console.error(`[ItineraryTools] POI search failed: ${e.message}`, e.cause ? `cause: ${JSON.stringify(e.cause)}` : "");
  }
  return [];
}

async function amapAroundSearch(
  location: string,
  keywords: string,
  types?: string,
  radius: number = 3000,
  offset: number = 3
): Promise<AmapPOI[]> {
  // 先查磁盘缓存
  const aroundCacheKey = `poi_around:${location}:${keywords}:${types || ""}:${radius}:${offset}`;
  const cachedAround = diskCacheGet<AmapPOI[]>(aroundCacheKey);
  if (cachedAround) {
    console.log(`[ItineraryTools] Around search cache HIT: ${location}/${keywords}`);
    return cachedAround;
  }
  const key = getAmapKey();
  if (!key) return [];
  const params = new URLSearchParams({
    key,
    location,
    keywords,
    radius: String(radius),
    offset: String(offset),
    extensions: "all",
  });
  if (types) params.set("types", types);
  try {
    const data = await httpsGet(`${AMAP_BASE}/place/around?${params}`);
    if (data.status === "1" && data.pois?.length > 0) {
      const aroundPois = data.pois.map((p: any) => ({
        name: p.name,
        address: typeof p.address === "string" ? p.address : "",
        location: p.location,
        type: p.type || "",
        rating: p.biz_ext?.rating,
        biz_ext: p.biz_ext,
      }));
      // 写入磁盘缓存（6小时TTL）
      diskCacheSet(aroundCacheKey, aroundPois, POI_TTL_MS);
      return aroundPois;
    }
  } catch (e) {
    console.error("[ItineraryTools] Around search failed:", e);
  }
  return [];
}

interface TransitResult {
  durationMin: number;
  description: string;
}

async function amapDrivingDuration(
  origin: string,
  destination: string
): Promise<TransitResult> {
  const key = getAmapKey();
  if (!key) return { durationMin: 30, description: "预估约30分钟（API不可用）" };
  try {
    const params = new URLSearchParams({ key, origin, destination, extensions: "base" });
    const data = await httpsGet(`${AMAP_BASE}/direction/driving?${params}`);
    if (data.status === "1" && data.route?.paths?.length > 0) {
      const path = data.route.paths[0];
      const durationSec = parseInt(path.duration, 10);
      const distanceM = parseInt(path.distance, 10);
      const durationMin = Math.ceil(durationSec / 60);
      const distanceKm = (distanceM / 1000).toFixed(1);
      return {
        durationMin,
        description: `驾车约${distanceKm}公里，预计${durationMin}分钟`,
      };
    }
  } catch (e) {
    console.error("[ItineraryTools] Driving direction failed:", e);
  }
  return { durationMin: 30, description: "预估约30分钟" };
}

async function amapTransitDuration(
  origin: string,
  destination: string,
  city: string
): Promise<TransitResult> {
  const key = getAmapKey();
  if (!key) return { durationMin: 45, description: "预估约45分钟（API不可用）" };
  try {
    const params = new URLSearchParams({ key, origin, destination, city, extensions: "base" });
    const data = await httpsGet(`${AMAP_BASE}/direction/transit/integrated?${params}`);
    if (data.status === "1" && data.route?.transits?.length > 0) {
      const transit = data.route.transits[0];
      const durationSec = parseInt(transit.duration, 10);
      const durationMin = Math.ceil(durationSec / 60);
      // 提取交通方式
      const segments = transit.segments || [];
      const modes: string[] = [];
      for (const seg of segments) {
        if (seg.bus?.buslines?.length > 0) {
          const line = seg.bus.buslines[0];
          modes.push(line.name?.split("(")[0] || "公交");
        }
        if (seg.railway) {
          modes.push(seg.railway.name || "地铁");
        }
      }
      const modeStr = modes.length > 0 ? modes.join(" → ") : "公共交通";
      return {
        durationMin,
        description: `${modeStr}，预计${durationMin}分钟`,
      };
    }
  } catch (e) {
    console.error("[ItineraryTools] Transit direction failed:", e);
  }
  // fallback to driving
  return amapDrivingDuration(origin, destination);
}

// ==================== 路程缓存（减少重复驾车 API 调用）====================

interface TransitCacheEntry {
  result: TransitResult;
  expireAt: number;
}

/** 内存 TTL 缓存：以 "origin|dest" 为 key，缓存 30 分钟 */
const transitCache = new Map<string, TransitCacheEntry>();
const TRANSIT_CACHE_TTL_MS = 30 * 60 * 1000;

function getTransitCacheKey(origin: string, destination: string): string {
  return `${origin}|${destination}`;
}

async function amapDrivingDurationCached(
  origin: string,
  destination: string
): Promise<TransitResult> {
  if (!origin || !destination || origin === destination) {
    return { durationMin: 0, description: "就地" };
  }
  const key = getTransitCacheKey(origin, destination);
  const cached = transitCache.get(key);
  if (cached && cached.expireAt > Date.now()) {
    return cached.result;
  }
  const result = await amapDrivingDuration(origin, destination);
  transitCache.set(key, { result, expireAt: Date.now() + TRANSIT_CACHE_TTL_MS });
  return result;
}

/**
 * 批量并发预取路程耗时，将结果写入缓存。
 * 在行程生成前一次性并发请求所有需要的 origin→dest 对，
 * 后续从缓存读取无需再等待。
 */
async function prefetchTransitDurations(
  pairs: Array<{ origin: string; destination: string }>
): Promise<void> {
  const uncached = pairs.filter(({ origin, destination }) => {
    if (!origin || !destination || origin === destination) return false;
    const key = getTransitCacheKey(origin, destination);
    const cached = transitCache.get(key);
    return !cached || cached.expireAt <= Date.now();
  });

  if (uncached.length === 0) return;

  console.log(`[ItineraryTools] Prefetching ${uncached.length} transit durations in parallel...`);
  const startTime = Date.now();

  await Promise.allSettled(
    uncached.map(async ({ origin, destination }) => {
      const result = await amapDrivingDuration(origin, destination);
      const key = getTransitCacheKey(origin, destination);
      transitCache.set(key, { result, expireAt: Date.now() + TRANSIT_CACHE_TTL_MS });
    })
  );

  console.log(`[ItineraryTools] Prefetch completed in ${Date.now() - startTime}ms`);
}

// ==================== 时间工具 ====================

function parseTime(timeStr: string): number {
  // "07:30" → 分钟数 450
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ==================== 核心行程生成 ====================

interface POIWithTransit {
  poi: AmapPOI;
  category: "sightseeing" | "lunch" | "dinner" | "breakfast" | "accommodation";
  suggestedDurationMin: number;
}

async function generateRealItinerary(
  destination: string,
  days: number,
  wakeUpTime: string,
  sleepTime: string,
  preferences?: string
): Promise<ItineraryData> {
  console.log(`[ItineraryTools] Generating itinerary: ${destination}, ${days} days, wake=${wakeUpTime}, sleep=${sleepTime}, prefs=${preferences || "none"}`);

  // 1. 地理编码
  const geo = await amapGeocode(destination);
  const cityCenter = geo ? `${geo.lng},${geo.lat}` : "";
  const cityName = geo?.city || destination;

  // 2. 搜索 POI（任一项失败不影响其他项，保证整体不被单点网络抖动拖垮）
  const [aRes, rRes, hRes, bRes] = await Promise.allSettled([
    amapPOISearch(`${destination} 景点`, cityName, "110000", 10),
    amapPOISearch(`${destination} 特色餐厅`, cityName, "050000", 8),
    amapPOISearch(`${destination} 酒店`, cityName, "100000", 3),
    amapPOISearch(`${destination} 早餐`, cityName, "050000", 3),
  ]);
  const attractions = aRes.status === "fulfilled" ? aRes.value : [];
  const restaurants = rRes.status === "fulfilled" ? rRes.value : [];
  const hotels = hRes.status === "fulfilled" ? hRes.value : [];
  const breakfastPlaces = bRes.status === "fulfilled" ? bRes.value : [];

  console.log(`[ItineraryTools] Found: ${attractions.length} attractions, ${restaurants.length} restaurants, ${hotels.length} hotels`);

  // 景点全空时直接返回友好错误（不触发 LLM 工具调用失败，而是让 LLM 用自然语言告知用户）
  if (attractions.length === 0 && restaurants.length === 0) {
    const keyMissing = !getAmapKey();
    const hint = keyMissing
      ? "（可能原因：高德地图 API Key 未配置或无效）"
      : `（可能原因：${destination} 在高德地图中未找到足够数据）`;
    throw new Error(
      `无法获取${destination}的景点和餐厅信息${hint}。建议确认目的地名称，或检查高德地图 API 服务是否正常。`
    );
  }

  // 3. 根据偏好筛选
  let filteredAttractions = [...attractions];
  if (preferences) {
    if (/自然|风光|公园|湖|山|海/.test(preferences)) {
      const nature = attractions.filter((a) => /风景|公园|湖|山|海|湿地|森林/.test(a.type + a.name));
      if (nature.length >= 3) filteredAttractions = nature;
    }
    if (/文化|历史|博物|寺|庙/.test(preferences)) {
      const culture = attractions.filter((a) => /博物|文化|历史|寺|庙|古/.test(a.type + a.name));
      if (culture.length >= 3) filteredAttractions = culture;
    }
  }

  // 3.5 预取所有路程耗时（并发，显著减少总耗时）
  const hotel = hotels[0] || { name: `${destination}酒店`, address: destination, location: cityCenter };
  {
    const allPOIs = [
      ...filteredAttractions.slice(0, days * 4),
      ...restaurants.slice(0, days * 2 + 1),
      ...(breakfastPlaces.length > 0 ? breakfastPlaces.slice(0, days) : []),
      hotel,
    ].filter((p) => p.location);
    const hotelLoc = hotel.location || cityCenter;
    const prefetchPairs: Array<{ origin: string; destination: string }> = [];
    for (const poi of allPOIs) {
      if (poi.location && poi.location !== hotelLoc) {
        prefetchPairs.push({ origin: hotelLoc, destination: poi.location });
        prefetchPairs.push({ origin: poi.location, destination: hotelLoc });
      }
    }
    for (let i = 0; i < allPOIs.length; i++) {
      for (let j = i + 1; j < allPOIs.length; j++) {
        const a = allPOIs[i];
        const b = allPOIs[j];
        if (a.location && b.location && a.location !== b.location) {
          prefetchPairs.push({ origin: a.location, destination: b.location });
        }
      }
    }
    const uniquePairs = Array.from(
      new Map(prefetchPairs.map((p) => [`${p.origin}|${p.destination}`, p])).values()
    );
    await prefetchTransitDurations(uniquePairs);
  }

  // 4. 构建每日行程
  const wakeMin = parseTime(wakeUpTime);
  const sleepMin = parseTime(sleepTime);

  const allDays: ItineraryDay[] = [];
  let attractionIdx = 0;
  let restaurantIdx = 0;

  const today = new Date();

  for (let d = 0; d < days; d++) {
    const dateObj = new Date(today);
    dateObj.setDate(today.getDate() + d + 1);
    const dateStr = dateObj.toISOString().split("T")[0];

    const stops: ItineraryStop[] = [];
    let currentTime = wakeMin;
    let currentLocation = hotel.location || cityCenter;
    let stopCounter = 1;

    // 起床
    stops.push({
      id: `d${d + 1}_s${stopCounter++}`,
      timeStart: formatTime(currentTime),
      timeEnd: formatTime(currentTime + 30),
      location: hotel.name,
      address: typeof hotel.address === "string" ? hotel.address : destination,
      activity: "起床洗漱，准备出发",
      durationMin: 30,
      type: "wake_up",
      lng: hotel.location?.split(",")[0],
      lat: hotel.location?.split(",")[1],
    });
    currentTime += 30;

    // 早餐
    const bfPlace = breakfastPlaces[d % breakfastPlaces.length] || { name: "酒店早餐", address: hotel.address || destination, location: hotel.location || cityCenter };
    let bfTransit: TransitResult = { durationMin: 0, description: "酒店内" };
    if (bfPlace.location && currentLocation && bfPlace.location !== currentLocation) {
      bfTransit = await amapDrivingDurationCached(currentLocation, bfPlace.location);
      if (bfTransit.durationMin > 3) {
        stops.push({
          id: `d${d + 1}_s${stopCounter++}`,
          timeStart: formatTime(currentTime),
          timeEnd: formatTime(currentTime + bfTransit.durationMin),
          location: `前往${bfPlace.name}`,
          address: "",
          activity: `从${hotel.name}出发前往早餐地点`,
          durationMin: bfTransit.durationMin,
          type: "transit",
          transitInfo: bfTransit.description,
        });
        currentTime += bfTransit.durationMin;
        currentLocation = bfPlace.location;
      }
    }

    stops.push({
      id: `d${d + 1}_s${stopCounter++}`,
      timeStart: formatTime(currentTime),
      timeEnd: formatTime(currentTime + 45),
      location: bfPlace.name,
      address: typeof bfPlace.address === "string" ? bfPlace.address : "",
      activity: `享用早餐`,
      durationMin: 45,
      type: "breakfast",
      lng: bfPlace.location?.split(",")[0],
      lat: bfPlace.location?.split(",")[1],
    });
    currentTime += 45;
    currentLocation = bfPlace.location || currentLocation;

    // 上午景点（2个）
    for (let i = 0; i < 2 && attractionIdx < filteredAttractions.length; i++) {
      const attr = filteredAttractions[attractionIdx++];
      if (!attr.location) continue;

      // 交通
      const transit = await amapDrivingDurationCached(currentLocation, attr.location);
      if (transit.durationMin > 3) {
        stops.push({
          id: `d${d + 1}_s${stopCounter++}`,
          timeStart: formatTime(currentTime),
          timeEnd: formatTime(currentTime + transit.durationMin),
          location: `前往${attr.name}`,
          address: "",
          activity: `从上一地点出发`,
          durationMin: transit.durationMin,
          type: "transit",
          transitInfo: transit.description,
        });
        currentTime += transit.durationMin;
      }

      // 游览
      const visitDuration = 90;
      if (currentTime + visitDuration > sleepMin - 60) break;
      stops.push({
        id: `d${d + 1}_s${stopCounter++}`,
        timeStart: formatTime(currentTime),
        timeEnd: formatTime(currentTime + visitDuration),
        location: attr.name,
        address: typeof attr.address === "string" ? attr.address : "",
        activity: `游览${attr.name}`,
        durationMin: visitDuration,
        type: "sightseeing",
        lng: attr.location.split(",")[0],
        lat: attr.location.split(",")[1],
      });
      currentTime += visitDuration;
      currentLocation = attr.location;
    }

    // 午餐
    const lunchPlace = restaurants[restaurantIdx++ % Math.max(restaurants.length, 1)] || { name: `${destination}餐厅`, address: destination, location: currentLocation };
    if (lunchPlace.location && currentLocation) {
      const lunchTransit = await amapDrivingDurationCached(currentLocation, lunchPlace.location);
      if (lunchTransit.durationMin > 3) {
        stops.push({
          id: `d${d + 1}_s${stopCounter++}`,
          timeStart: formatTime(currentTime),
          timeEnd: formatTime(currentTime + lunchTransit.durationMin),
          location: `前往${lunchPlace.name}`,
          address: "",
          activity: `前往午餐地点`,
          durationMin: lunchTransit.durationMin,
          type: "transit",
          transitInfo: lunchTransit.description,
        });
        currentTime += lunchTransit.durationMin;
        currentLocation = lunchPlace.location;
      }
    }

    stops.push({
      id: `d${d + 1}_s${stopCounter++}`,
      timeStart: formatTime(currentTime),
      timeEnd: formatTime(currentTime + 60),
      location: lunchPlace.name,
      address: typeof lunchPlace.address === "string" ? lunchPlace.address : "",
      activity: `午餐，品尝${destination}特色美食`,
      durationMin: 60,
      type: "lunch",
      lng: lunchPlace.location?.split(",")[0],
      lat: lunchPlace.location?.split(",")[1],
    });
    currentTime += 60;
    currentLocation = lunchPlace.location || currentLocation;

    // 下午景点（2个）
    for (let i = 0; i < 2 && attractionIdx < filteredAttractions.length; i++) {
      const attr = filteredAttractions[attractionIdx++];
      if (!attr.location) continue;

      const transit = await amapDrivingDurationCached(currentLocation, attr.location);
      if (transit.durationMin > 3) {
        stops.push({
          id: `d${d + 1}_s${stopCounter++}`,
          timeStart: formatTime(currentTime),
          timeEnd: formatTime(currentTime + transit.durationMin),
          location: `前往${attr.name}`,
          address: "",
          activity: `从上一地点出发`,
          durationMin: transit.durationMin,
          type: "transit",
          transitInfo: transit.description,
        });
        currentTime += transit.durationMin;
      }

      const visitDuration = 90;
      if (currentTime + visitDuration > sleepMin - 120) break;
      stops.push({
        id: `d${d + 1}_s${stopCounter++}`,
        timeStart: formatTime(currentTime),
        timeEnd: formatTime(currentTime + visitDuration),
        location: attr.name,
        address: typeof attr.address === "string" ? attr.address : "",
        activity: `游览${attr.name}`,
        durationMin: visitDuration,
        type: "sightseeing",
        lng: attr.location.split(",")[0],
        lat: attr.location.split(",")[1],
      });
      currentTime += visitDuration;
      currentLocation = attr.location;
    }

    // 晚餐
    const dinnerPlace = restaurants[restaurantIdx++ % Math.max(restaurants.length, 1)] || { name: `${destination}晚餐`, address: destination, location: currentLocation };
    if (dinnerPlace.location && currentLocation) {
      const dinnerTransit = await amapDrivingDurationCached(currentLocation, dinnerPlace.location);
      if (dinnerTransit.durationMin > 3) {
        stops.push({
          id: `d${d + 1}_s${stopCounter++}`,
          timeStart: formatTime(currentTime),
          timeEnd: formatTime(currentTime + dinnerTransit.durationMin),
          location: `前往${dinnerPlace.name}`,
          address: "",
          activity: `前往晚餐地点`,
          durationMin: dinnerTransit.durationMin,
          type: "transit",
          transitInfo: dinnerTransit.description,
        });
        currentTime += dinnerTransit.durationMin;
        currentLocation = dinnerPlace.location;
      }
    }

    stops.push({
      id: `d${d + 1}_s${stopCounter++}`,
      timeStart: formatTime(currentTime),
      timeEnd: formatTime(currentTime + 75),
      location: dinnerPlace.name,
      address: typeof dinnerPlace.address === "string" ? dinnerPlace.address : "",
      activity: `晚餐，享用${destination}美食`,
      durationMin: 75,
      type: "dinner",
      lng: dinnerPlace.location?.split(",")[0],
      lat: dinnerPlace.location?.split(",")[1],
    });
    currentTime += 75;
    currentLocation = dinnerPlace.location || currentLocation;

    // 返回酒店
    if (hotel.location && currentLocation && hotel.location !== currentLocation) {
      const hotelTransit = await amapDrivingDurationCached(currentLocation, hotel.location);
      if (hotelTransit.durationMin > 3) {
        stops.push({
          id: `d${d + 1}_s${stopCounter++}`,
          timeStart: formatTime(currentTime),
          timeEnd: formatTime(currentTime + hotelTransit.durationMin),
          location: `返回${hotel.name}`,
          address: "",
          activity: `返回酒店休息`,
          durationMin: hotelTransit.durationMin,
          type: "transit",
          transitInfo: hotelTransit.description,
        });
        currentTime += hotelTransit.durationMin;
      }
    }

    // 住宿/休息
    stops.push({
      id: `d${d + 1}_s${stopCounter++}`,
      timeStart: formatTime(currentTime),
      timeEnd: sleepTime,
      location: hotel.name,
      address: typeof hotel.address === "string" ? hotel.address : destination,
      activity: "回到酒店，休息就寝",
      durationMin: sleepMin - currentTime,
      type: "accommodation",
      lng: hotel.location?.split(",")[0],
      lat: hotel.location?.split(",")[1],
    });

    allDays.push({ day: d + 1, date: dateStr, stops });
  }

  // 5. 生成摘要
  const totalAttractions = allDays.reduce(
    (sum, day) => sum + day.stops.filter((s) => s.type === "sightseeing").length,
    0
  );
  const summary = `${destination}${days}日行程规划：每天${wakeUpTime}起床、${sleepTime}就寝，共游览${totalAttractions}个景点，包含真实交通耗时。`;

  return {
    destination,
    days: allDays,
    totalDays: days,
    wakeUpTime,
    sleepTime,
    summary,
  };
}

// ==================== 格式化输出 ====================

function formatItineraryText(data: ItineraryData): string {
  const lines: string[] = [];
  lines.push(`# ${data.destination} ${data.totalDays}日行程规划`);
  lines.push(`> 作息：${data.wakeUpTime} 起床，${data.sleepTime} 就寝`);
  lines.push("");

  for (const day of data.days) {
    lines.push(`## 第${day.day}天（${day.date}）`);
    lines.push("");
    lines.push("| 时间 | 类型 | 地点 | 活动 | 交通信息 |");
    lines.push("|------|------|------|------|----------|");

    for (const stop of day.stops) {
      const typeLabel: Record<ActivityType, string> = {
        wake_up: "🌅 起床",
        breakfast: "🥐 早餐",
        transit: "🚗 出行",
        sightseeing: "🏛️ 游玩",
        lunch: "🍜 午餐",
        dinner: "🍽️ 晚餐",
        accommodation: "🏨 住宿",
        rest: "😴 休息",
        other: "📌 其他",
      };
      const transitCol = stop.transitInfo || "-";
      lines.push(
        `| ${stop.timeStart}-${stop.timeEnd} | ${typeLabel[stop.type]} | ${stop.location} | ${stop.activity} | ${transitCol} |`
      );
    }
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`*${data.summary}*`);
  lines.push(`*交通耗时数据来源：高德地图路径规划 API（实时计算）*`);

  return lines.join("\n");
}

// ==================== 工具实现 ====================

export function generateItineraryImpl(args: Record<string, unknown>): Promise<string> | string {
  const destination = args.destination as string | undefined;
  const preferences = args.preferences as string | undefined;
  const daysInput = args.days as number | string | undefined;
  const wakeUpInput = args.wake_up_time as string | undefined;
  const sleepInput = args.sleep_time as string | undefined;

  if (!destination || destination.trim().length === 0) {
    return JSON.stringify({
      success: false,
      error: "destination 参数不能为空，请指定目的地",
    });
  }

  const days = typeof daysInput === "number" ? daysInput : parseInt(String(daysInput || "1"), 10) || 1;
  const wakeUpTime = wakeUpInput || "07:30";
  const sleepTime = sleepInput || "23:00";

  // 异步执行
  return generateRealItinerary(destination.trim(), Math.min(days, 7), wakeUpTime, sleepTime, preferences)
    .then((itinerary) => {
      const text = formatItineraryText(itinerary);
      return JSON.stringify({
        success: true,
        itinerary,
        formattedText: text,
      });
    })
    .catch((error) => {
      console.error("[ItineraryTools] Generation failed:", error);
      return JSON.stringify({
        success: false,
        error: `行程生成失败: ${(error as Error).message}`,
      });
    });
}

// ==================== 注册函数 ====================

export function registerItineraryTools(registry: ToolRegistry): void {
  registry.register({
    name: "generate_itinerary",
    description:
      "生成精确到分钟的完整行程规划。根据目的地、天数、用户作息时间和偏好，调用高德地图API获取真实景点和交通耗时，生成包含起床、早餐、出行、游玩、午餐、晚餐、住宿等环节的详细时间表。",
    inputSchema: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description: "目的地城市或区域，如 '杭州'、'上海'、'北京'",
        },
        days: {
          type: "number",
          description: "行程天数，默认1天，最多7天",
        },
        wake_up_time: {
          type: "string",
          description: "起床时间，格式 HH:mm，如 '07:30'，默认 '07:30'",
        },
        sleep_time: {
          type: "string",
          description: "就寝时间，格式 HH:mm，如 '23:00'，默认 '23:00'",
        },
        preferences: {
          type: "string",
          description: "用户偏好，如 '自然风光'、'历史文化'、'美食'、'亲子'、'紧凑'、'宽松'",
        },
      },
      required: ["destination"],
    },
    serverId: ITINERARY_TOOLS_SERVER_ID,
    category: "navigation",
    registeredAt: new Date(),
  });
}

export async function callItineraryTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  if (toolName === "generate_itinerary") {
    const result = generateItineraryImpl(args);
    if (typeof result === "string") return result;
    return await result;
  }
  return JSON.stringify({ error: `未知的行程工具: ${toolName}` });
}
