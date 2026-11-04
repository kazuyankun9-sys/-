import { NextResponse } from "next/server";
import { z } from "zod";
import { generateReport, templateReport } from "@/lib/report";
import { clientIp, hitRateLimit, takeDailyAiQuota } from "@/lib/rateLimit";
import type { AuditResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const CheckSchema = z.object({
  id: z.string().max(40),
  category: z.enum(["mobile", "seo", "trust", "conversion", "freshness"]),
  label: z.string().max(100),
  status: z.enum(["pass", "warn", "fail"]),
  score: z.number(),
  maxScore: z.number(),
  finding: z.string().max(500),
  impact: z.string().max(500),
  fix: z.string().max(500),
});

const AuditSchema = z.object({
  inputUrl: z.string().max(2048),
  finalUrl: z.string().max(2048),
  fetchedAt: z.string().max(40),
  responseMs: z.number(),
  htmlBytes: z.number(),
  totalScore: z.number().min(0).max(100),
  grade: z.enum(["S", "A", "B", "C", "D"]),
  categories: z
    .array(z.object({ id: z.enum(["mobile", "seo", "trust", "conversion", "freshness"]), label: z.string().max(50), score: z.number(), max: z.number() }))
    .max(10),
  checks: z.array(CheckSchema).max(40),
  pagespeed: z.union([
    z.object({ ok: z.literal(true), performance: z.number(), lcpMs: z.number().nullable(), cls: z.number().nullable(), tbtMs: z.number().nullable(), fcpMs: z.number().nullable() }),
    z.object({ ok: z.literal(false), reason: z.string().max(200) }),
  ]),
  facts: z.object({
    title: z.string().max(300),
    description: z.string().max(1000),
    h1: z.array(z.string().max(300)).max(10),
    headings: z.array(z.string().max(100)).max(30),
    navLinks: z.array(z.string().max(40)).max(40),
    phoneNumbers: z.array(z.string().max(30)).max(5),
    latestDate: z.string().max(30).nullable(),
    copyrightYear: z.number().nullable(),
    snsFound: z.array(z.string().max(30)).max(10),
    textExcerpt: z.string().max(3000),
    subpageExcerpt: z.string().max(1500).default(""),
  }),
  pagesChecked: z
    .array(z.object({ kind: z.enum(["top", "company", "contact"]), url: z.string().max(2048) }))
    .max(5)
    .default([]),
  industry: z
    .object({
      id: z.enum(["construction", "dental", "clinic", "professional", "manufacturing", "restaurant", "beauty", "realestate", "other"]),
      label: z.string().max(60),
    })
    .default({ id: "other", label: "その他・不明" }),
});

const Body = z.object({
  audit: AuditSchema,
  context: z
    .object({ industry: z.string().max(60).optional(), product: z.string().max(60).optional() })
    .default({}),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "診断結果の形式が正しくありません。" }, { status: 400 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }
  const audit = body.audit as AuditResult;

  if (hitRateLimit(`report:${clientIp(req)}`, 15, 60 * 60 * 1000)) {
    return NextResponse.json(templateReport(audit, body.context, "短時間に利用が集中したため、簡易レポートを表示しています。"));
  }
  if (!takeDailyAiQuota()) {
    return NextResponse.json(templateReport(audit, body.context, "本日のAIレポートの上限に達したため、簡易レポートを表示しています。"));
  }

  const report = await generateReport(audit, body.context);
  return NextResponse.json(report);
}
