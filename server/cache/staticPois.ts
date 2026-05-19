/**
 * staticPois.ts — 静态 POI 预热数据
 *
 * 预先存储 Demo 场景中高频城市的热门景点、交通枢纽、商圈坐标。
 * 服务启动时直接加载到 diskCache，跳过 maps_geo / maps_text_search 调用。
 *
 * 数据来源：高德地图官方坐标（GCJ-02 坐标系）
 * 更新策略：手动维护，每季度核对一次。
 */

import { diskCacheSet, GEOCODE_TTL_MS, POI_TTL_MS } from "./diskCache";

// ==================== 类型 ====================

export interface StaticGeocode {
  lng: string;
  lat: string;
  city: string;
}

export interface StaticPOI {
  name: string;
  address: string;
  location: string; // "lng,lat"
  type: string;
  rating?: string;
}

// ==================== 静态 Geocode 数据 ====================

const STATIC_GEOCODES: Record<string, StaticGeocode> = {
  // 苏州
  "苏州": { lng: "120.619585", lat: "31.299379", city: "苏州" },
  "苏州市": { lng: "120.619585", lat: "31.299379", city: "苏州" },
  "苏州北站": { lng: "120.583590", lat: "31.368870", city: "苏州" },
  "苏州站": { lng: "120.611080", lat: "31.317870", city: "苏州" },
  "苏州南站": { lng: "120.543580", lat: "31.175530", city: "苏州" },
  "苏州园区": { lng: "120.757580", lat: "31.288940", city: "苏州" },
  "苏州工业园区": { lng: "120.757580", lat: "31.288940", city: "苏州" },
  "太湖": { lng: "120.196078", lat: "31.131075", city: "苏州" },
  "太湖广场": { lng: "120.196078", lat: "31.131075", city: "苏州" },
  "拙政园": { lng: "120.636839", lat: "31.321499", city: "苏州" },
  "虎丘": { lng: "120.574799", lat: "31.336499", city: "苏州" },
  "寒山寺": { lng: "120.573099", lat: "31.308299", city: "苏州" },
  "平江路": { lng: "120.634699", lat: "31.318699", city: "苏州" },
  "观前街": { lng: "120.626099", lat: "31.312099", city: "苏州" },
  // 杭州
  "杭州": { lng: "120.153576", lat: "30.287459", city: "杭州" },
  "杭州市": { lng: "120.153576", lat: "30.287459", city: "杭州" },
  "杭州东站": { lng: "120.212700", lat: "30.291600", city: "杭州" },
  "杭州站": { lng: "120.133700", lat: "30.245600", city: "杭州" },
  "杭州西站": { lng: "119.985400", lat: "30.321900", city: "杭州" },
  "西湖": { lng: "120.148400", lat: "30.259900", city: "杭州" },
  "灵隐寺": { lng: "120.101300", lat: "30.241800", city: "杭州" },
  "西溪湿地": { lng: "120.063800", lat: "30.264900", city: "杭州" },
  "宋城": { lng: "120.125200", lat: "30.196800", city: "杭州" },
  "河坊街": { lng: "120.162100", lat: "30.239600", city: "杭州" },
  "断桥残雪": { lng: "120.151800", lat: "30.261600", city: "杭州" },
  "雷峰塔": { lng: "120.148200", lat: "30.231900", city: "杭州" },
  // 上海
  "上海": { lng: "121.473701", lat: "31.230416", city: "上海" },
  "上海市": { lng: "121.473701", lat: "31.230416", city: "上海" },
  "上海虹桥站": { lng: "121.321900", lat: "31.194600", city: "上海" },
  "上海虹桥机场": { lng: "121.336900", lat: "31.197900", city: "上海" },
  "上海浦东机场": { lng: "121.805200", lat: "31.143400", city: "上海" },
  "上海南站": { lng: "121.432700", lat: "31.154200", city: "上海" },
  "上海站": { lng: "121.455900", lat: "31.249700", city: "上海" },
  "外滩": { lng: "121.490300", lat: "31.239900", city: "上海" },
  "东方明珠": { lng: "121.499800", lat: "31.239600", city: "上海" },
  "南京路步行街": { lng: "121.477200", lat: "31.235300", city: "上海" },
  "豫园": { lng: "121.491800", lat: "31.227300", city: "上海" },
  // 北京
  "北京": { lng: "116.407526", lat: "39.904030", city: "北京" },
  "北京市": { lng: "116.407526", lat: "39.904030", city: "北京" },
  "北京南站": { lng: "116.378400", lat: "39.865300", city: "北京" },
  "北京站": { lng: "116.427600", lat: "39.902800", city: "北京" },
  "北京西站": { lng: "116.322400", lat: "39.894800", city: "北京" },
  "天安门": { lng: "116.397500", lat: "39.908800", city: "北京" },
  "故宫": { lng: "116.397000", lat: "39.916300", city: "北京" },
  "颐和园": { lng: "116.275100", lat: "39.999600", city: "北京" },
  "长城": { lng: "116.570500", lat: "40.431900", city: "北京" },
  "三里屯": { lng: "116.454400", lat: "39.937600", city: "北京" },
};

// ==================== 静态 POI 数据（按城市+类型） ====================

const STATIC_POIS: Record<string, StaticPOI[]> = {
  // 苏州景点
  "苏州_景点": [
    { name: "拙政园", address: "苏州市姑苏区东北街178号", location: "120.636839,31.321499", type: "风景名胜", rating: "4.8" },
    { name: "虎丘", address: "苏州市姑苏区虎丘路8号", location: "120.574799,31.336499", type: "风景名胜", rating: "4.7" },
    { name: "寒山寺", address: "苏州市姑苏区寒山寺弄24号", location: "120.573099,31.308299", type: "宗教场所", rating: "4.6" },
    { name: "平江路历史街区", address: "苏州市姑苏区平江路", location: "120.634699,31.318699", type: "历史街区", rating: "4.7" },
    { name: "留园", address: "苏州市姑苏区留园路338号", location: "120.598399,31.316799", type: "风景名胜", rating: "4.7" },
    { name: "苏州博物馆", address: "苏州市姑苏区东北街204号", location: "120.632599,31.322399", type: "博物馆", rating: "4.8" },
  ],
  // 杭州景点
  "杭州_景点": [
    { name: "西湖风景名胜区", address: "杭州市西湖区龙井路1号", location: "120.148400,30.259900", type: "风景名胜", rating: "4.9" },
    { name: "灵隐寺", address: "杭州市西湖区灵隐路法云弄1号", location: "120.101300,30.241800", type: "宗教场所", rating: "4.7" },
    { name: "西溪国家湿地公园", address: "杭州市西湖区天目山路518号", location: "120.063800,30.264900", type: "风景名胜", rating: "4.6" },
    { name: "宋城景区", address: "杭州市西湖区之江路148号", location: "120.125200,30.196800", type: "主题公园", rating: "4.5" },
    { name: "河坊街", address: "杭州市上城区河坊街", location: "120.162100,30.239600", type: "历史街区", rating: "4.5" },
    { name: "雷峰塔", address: "杭州市西湖区南山路15号", location: "120.148200,30.231900", type: "历史建筑", rating: "4.6" },
  ],
  // 苏州酒店
  "苏州_酒店": [
    { name: "苏州香格里拉大酒店", address: "苏州市姑苏区太平洋广场1号", location: "120.620099,31.302999", type: "五星级酒店", rating: "4.8" },
    { name: "苏州金鸡湖万丽酒店", address: "苏州工业园区苏绣路88号", location: "120.757099,31.290899", type: "五星级酒店", rating: "4.7" },
    { name: "苏州太湖万豪酒店", address: "苏州市吴中区太湖大道1号", location: "120.433699,31.138799", type: "五星级酒店", rating: "4.6" },
    { name: "苏州园区凯宾斯基酒店", address: "苏州工业园区中新大道西199号", location: "120.741099,31.287999", type: "五星级酒店", rating: "4.7" },
  ],
  // 杭州酒店
  "杭州_酒店": [
    { name: "杭州西湖国宾馆", address: "杭州市西湖区北山路2号", location: "120.143599,30.256299", type: "五星级酒店", rating: "4.9" },
    { name: "杭州四季酒店", address: "杭州市西湖区灵隐路5号", location: "120.107499,30.248799", type: "五星级酒店", rating: "4.8" },
    { name: "杭州君悦酒店", address: "杭州市上城区富春路9号", location: "120.173599,30.246799", type: "五星级酒店", rating: "4.7" },
    { name: "杭州洲际酒店", address: "杭州市滨江区滨盛路1号", location: "120.196099,30.200099", type: "五星级酒店", rating: "4.6" },
  ],
};

// ==================== 预热函数 ====================

/**
 * 将静态 POI 和 Geocode 数据写入 diskCache。
 * 在服务启动时调用一次，后续 itineraryTools 直接从缓存读取。
 */
export function warmupStaticPois(): void {
  let geocodeCount = 0;
  let poiCount = 0;

  // 写入 geocode 数据
  for (const [address, result] of Object.entries(STATIC_GEOCODES)) {
    const key = `geocode:${address.toLowerCase()}`;
    diskCacheSet(key, result, GEOCODE_TTL_MS);
    geocodeCount++;
  }

  // 写入 POI 数据
  for (const [cacheKey, pois] of Object.entries(STATIC_POIS)) {
    const key = `poi:${cacheKey.toLowerCase()}`;
    diskCacheSet(key, pois, POI_TTL_MS);
    poiCount++;
  }

  console.log(
    `[StaticPois] Warmup complete: ${geocodeCount} geocodes, ${poiCount} POI groups preloaded`
  );
}

/**
 * 查询静态 geocode 缓存键。
 */
export function getGeocodeKey(address: string): string {
  return `geocode:${address.toLowerCase().trim()}`;
}

/**
 * 查询静态 POI 缓存键。
 */
export function getPoiKey(city: string, type: string): string {
  return `poi:${city.toLowerCase()}_${type.toLowerCase()}`;
}
