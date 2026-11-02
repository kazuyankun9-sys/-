import type { PageSpeedError, PageSpeedResult } from "./types";

/**
 * Google PageSpeed Insights（無料）でスマホ表示の速度を計測する。
 * APIキーが無くても動くが、無料枠が小さいため失敗することがある。失敗しても診断は続ける。
 */
export async function runPageSpeed(url: string, timeoutMs = 40000): Promise<PageSpeedResult | PageSpeedError> {
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", "mobile");
  endpoint.searchParams.set("category", "performance");
  endpoint.searchParams.set("locale", "ja");
  const key = process.env.PAGESPEED_API_KEY;
  if (key) endpoint.searchParams.set("key", key);

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (res.status === 429) return { ok: false, reason: "計測サービスの利用上限に達しました（APIキーを設定すると改善します）" };
    if (!res.ok) return { ok: false, reason: `計測サービスがエラーを返しました（${res.status}）` };
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number | null } };
        audits?: Record<string, { numericValue?: number }>;
      };
    };
    const lh = data.lighthouseResult;
    const score = lh?.categories?.performance?.score;
    if (typeof score !== "number") return { ok: false, reason: "速度スコアを取得できませんでした" };
    const num = (id: string) => {
      const v = lh?.audits?.[id]?.numericValue;
      return typeof v === "number" ? v : null;
    };
    return {
      ok: true,
      performance: Math.round(score * 100),
      lcpMs: num("largest-contentful-paint"),
      cls: num("cumulative-layout-shift"),
      tbtMs: num("total-blocking-time"),
      fcpMs: num("first-contentful-paint"),
    };
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, reason: "速度計測が時間切れになりました" };
    return { ok: false, reason: "速度計測サービスに接続できませんでした" };
  }
}
