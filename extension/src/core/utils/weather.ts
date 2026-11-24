/**
 * 天气：Open-Meteo（免费、无需密钥，数据 CC BY 4.0，需注明来源）
 * - 选城市时请求地理编码接口（发送输入的城市名）
 * - 之后只用经纬度请求天气，结果缓存 30 分钟，多个新标签页共用一份缓存
 */
import type { WeatherCity } from '../types/model';
import { sanitizeCity } from '../../../shared/model.js';

const GEOCODE_API = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const CACHE_KEY = 'gce_weather_cache';
export const WEATHER_TTL_MS = 30 * 60 * 1000;

export interface WeatherNow {
  temp: number;
  code: number;
  isDay: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 按名称搜索城市（中文名可用） */
export async function searchCity(query: string): Promise<WeatherCity[]> {
  const params = new URLSearchParams({ name: query, count: '8', language: 'zh', format: 'json' });
  const data = await getJson(`${GEOCODE_API}?${params}`);
  const list = isRecord(data) && Array.isArray(data.results) ? data.results : [];
  const out: WeatherCity[] = [];
  for (const r of list) {
    if (!isRecord(r)) continue;
    const city = sanitizeCity({ name: r.name, admin: r.admin1, country: r.country, lat: r.latitude, lon: r.longitude });
    if (city) out.push(city);
  }
  return out;
}

const cacheId = (c: WeatherCity) => `${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;

function readCache(c: WeatherCity): WeatherNow | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!isRecord(raw) || raw.id !== cacheId(c) || !finiteNum(raw.at) || Date.now() - raw.at > WEATHER_TTL_MS) return null;
    const v = raw.value;
    if (!isRecord(v) || !finiteNum(v.temp) || !finiteNum(v.code) || typeof v.isDay !== 'boolean') return null;
    return { temp: v.temp, code: v.code, isDay: v.isDay };
  } catch {
    return null;
  }
}

export async function getWeather(city: WeatherCity): Promise<WeatherNow> {
  const hit = readCache(city);
  if (hit) return hit;
  const params = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    current: 'temperature_2m,weather_code,is_day',
    timezone: 'auto',
  });
  const data = await getJson(`${FORECAST_API}?${params}`);
  const cur = isRecord(data) ? data.current : undefined;
  if (!isRecord(cur) || !finiteNum(cur.temperature_2m) || !finiteNum(cur.weather_code)) throw new Error('天气数据格式错误');
  const value: WeatherNow = { temp: cur.temperature_2m, code: cur.weather_code, isDay: cur.is_day !== 0 };
  localStorage.setItem(CACHE_KEY, JSON.stringify({ id: cacheId(city), at: Date.now(), value }));
  return value;
}

/** WMO 天气代码（Open-Meteo 文档中的对照表） */
const WMO: Record<number, string> = {
  0: '晴', 1: '晴间多云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '阵雨', 81: '中阵雨', 82: '强阵雨', 85: '阵雪', 86: '强阵雪',
  95: '雷雨', 96: '雷雨伴小冰雹', 97: '强雷雨', 99: '雷雨伴大冰雹',
};

export function weatherText(code: number): string {
  return WMO[code] ?? '未知天气';
}

export function cityLabel(c: WeatherCity): string {
  return [c.name, c.admin && c.admin !== c.name ? c.admin : '', c.country].filter(Boolean).join('，');
}
