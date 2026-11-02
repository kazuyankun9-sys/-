/**
 * シンプルなメモリ内レート制限。
 * サーバーが1台（または試作段階）を想定。本番で複数台に増やす場合は
 * Upstash Redis などの共有ストアに置き換える。
 */

const buckets = new Map<string, number[]>();

export function hitRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    buckets.set(key, list);
    return true;
  }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return false;
}

let dailyKey = "";
let dailyCount = 0;

/** サーバー全体での1日あたりのAI利用回数（API料金の使いすぎ防止） */
export function takeDailyAiQuota(): boolean {
  const limit = Number(process.env.DAILY_AI_LIMIT ?? 30);
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyKey) {
    dailyKey = today;
    dailyCount = 0;
  }
  if (dailyCount >= limit) return false;
  dailyCount++;
  return true;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
