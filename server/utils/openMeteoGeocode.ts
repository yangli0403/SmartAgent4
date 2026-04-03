/**
 * Open-Meteo 地理编码（无 API Key），供上下文「常住地」等与 Agent 工具链解耦。
 */

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  city: string;
  address: string;
}

const CJK = /[\u4e00-\u9fff]/;

/**
 * 将地名或地址片段解析为经纬度与城市展示名。
 * 中文查询默认限定 countryCode=CN，减少海外同名干扰。
 */
export async function geocodePlaceName(
  query: string
): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (q.length < 2) return null;

  try {
    const params = new URLSearchParams({
      name: q,
      count: "8",
      language: "zh",
      format: "json",
    });
    if (CJK.test(q)) {
      params.set("countryCode", "CN");
    }

    const url = `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      results?: Array<{
        name: string;
        latitude: number;
        longitude: number;
        country?: string;
        country_code?: string;
        admin1?: string;
        admin2?: string;
      }>;
    };

    const results = data.results;
    if (!results?.length) return null;

    const cn =
      results.find((r) => r.country_code === "CN") ?? results[0];
    const city =
      cn.admin2 || cn.admin1 || cn.name || q;
    const address = [cn.country, cn.admin1, cn.admin2, cn.name]
      .filter(Boolean)
      .join(" ");

    return {
      latitude: cn.latitude,
      longitude: cn.longitude,
      city,
      address: address || q,
    };
  } catch (e) {
    console.warn(
      `[openMeteoGeocode] failed for "${q}": ${(e as Error).message}`
    );
    return null;
  }
}
