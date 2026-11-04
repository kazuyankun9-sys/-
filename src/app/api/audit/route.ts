import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeHtml, findSubpageLinks, type SubpageInput } from "@/lib/audit";
import { runPageSpeed } from "@/lib/pagespeed";
import { clientIp, hitRateLimit } from "@/lib/rateLimit";
import { loadRobots } from "@/lib/robots";
import { decodeHtml, FetchError, normalizeUrl, safeFetch } from "@/lib/safeFetch";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ url: z.string().min(1).max(2048) });

export async function POST(req: Request) {
  if (hitRateLimit(`audit:${clientIp(req)}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "短時間に診断が集中しています。1時間ほどおいてから再度お試しください。" }, { status: 429 });
  }

  let url: URL;
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "URLを入力してください。" }, { status: 400 });
    url = normalizeUrl(parsed.data.url);
  } catch (e) {
    const msg = e instanceof FetchError ? e.userMessage : "リクエストの形式が正しくありません。";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const robotsAllows = await loadRobots(url);
  if (!robotsAllows(url)) {
    return NextResponse.json(
      { error: "このサイトは、自動ツールによるアクセスを許可していない（robots.txt）ため、診断できません。" },
      { status: 403 },
    );
  }

  // ページ取得と速度計測を同時に進める
  const pagespeedPromise = runPageSpeed(url.toString());
  try {
    const page = await safeFetch(url);
    if (page.status >= 400) {
      return NextResponse.json(
        { error: `サイトがエラーを返しました（ステータス ${page.status}）。URLが正しいか確認してください。` },
        { status: 422 },
      );
    }
    const contentType = String(page.headers["content-type"] ?? "");
    if (contentType && !/html|xml/i.test(contentType)) {
      return NextResponse.json({ error: "このURLはホームページ（HTML）ではないようです。" }, { status: 422 });
    }
    const html = decodeHtml(page.body, contentType);
    // 会社概要・お問い合わせのページを最大2ページだけ読む（速度計測を待つ間に進める）
    const subpages = await fetchSubpages(html, page.finalUrl, robotsAllows);
    const pagespeed = await pagespeedPromise;
    const result = analyzeHtml({
      html,
      inputUrl: url.toString(),
      finalUrl: page.finalUrl,
      responseMs: page.elapsedMs,
      htmlBytes: page.body.length,
      pagespeed,
      subpages,
    });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof FetchError ? e.userMessage : "診断中にエラーが発生しました。";
    if (!(e instanceof FetchError)) console.error("[audit]", e);
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}

async function fetchSubpages(html: string, baseUrl: string, robotsAllows: (u: URL) => boolean): Promise<SubpageInput[]> {
  const result: SubpageInput[] = [];
  let links: ReturnType<typeof findSubpageLinks>;
  try {
    links = findSubpageLinks(html, baseUrl);
  } catch {
    return result;
  }
  // 相手のサーバーに負担をかけないよう、同時ではなく1ページずつ読む
  for (const link of links.slice(0, 2)) {
    try {
      const u = normalizeUrl(link.url);
      if (!robotsAllows(u)) continue;
      const res = await safeFetch(u, { timeoutMs: 6000, maxBytes: 1024 * 1024 });
      const ct = String(res.headers["content-type"] ?? "");
      if (res.status >= 400 || (ct && !/html|xml/i.test(ct))) continue;
      result.push({ kind: link.kind, url: res.finalUrl, html: decodeHtml(res.body, ct) });
    } catch {
      // 下層ページが読めなくても、トップページだけで診断を続ける
    }
  }
  return result;
}
