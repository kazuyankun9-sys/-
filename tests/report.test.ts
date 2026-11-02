import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeHtml } from "@/lib/audit";
import { generateReport } from "@/lib/report";

/**
 * 本物のAPIは呼ばずに、ダミーサーバーで「送るリクエストの形」と「結果の読み取り」を検証する。
 */

const AI_OUTPUT = {
  ownerReport: {
    headline: "スマホ対応で問い合わせが伸びるサイト",
    summary: "総評です。",
    strengths: ["SSL対応済み"],
    lossPoints: [{ title: "スマホ非対応", detail: "読みにくい" }],
    improvements: [{ title: "スマホ対応", why: "閲覧の多くがスマホ", how: "レスポンシブ化", priority: "high", effort: "制作が必要" }],
  },
  salesMemo: {
    opening: "拝見しました。",
    hearingQuestions: [{ question: "Q", intent: "I" }],
    proposalAngles: [{ title: "T", pitch: "P" }],
    objections: [{ objection: "O", response: "R" }],
    nextAction: "N",
  },
};

let server: http.Server;
let lastBody: Record<string, unknown> = {};
let lastHeaders: http.IncomingHttpHeaders = {};
let mode: "ok" | "refusal" | "error" = "ok";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastBody = JSON.parse(raw);
      lastHeaders = req.headers;
      if (mode === "error") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: lastBody.model,
          content: mode === "ok" ? [{ type: "text", text: JSON.stringify(AI_OUTPUT) }] : [],
          stop_reason: mode === "ok" ? "end_turn" : "refusal",
          stop_sequence: null,
          stop_details: mode === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  delete process.env.CLAUDE_MODEL;
});

afterAll(() => {
  server.close();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
});

const audit = analyzeHtml({
  html: "<html><head><title>テスト</title></head><body><p>本文</p></body></html>",
  inputUrl: "https://a.jp/",
  finalUrl: "https://a.jp/",
  responseMs: 100,
  htmlBytes: 100,
  pagespeed: { ok: false, reason: "テスト" },
});

describe("generateReport (Claude API)", () => {
  it("構造化出力・フォールバック付きでリクエストし、結果を読み取る", async () => {
    mode = "ok";
    const r = await generateReport(audit, { industry: "工務店", product: "MEO" });
    expect(r.source).toBe("ai");
    expect(r.ownerReport.headline).toBe(AI_OUTPUT.ownerReport.headline);

    expect(lastBody.model).toBe("claude-opus-5-5");
    expect(lastBody.fallbacks).toBe("default");
    expect(String(lastHeaders["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    const oc = lastBody.output_config as { effort: string; format: { type: string; schema: object } };
    expect(oc.effort).toBe("medium");
    expect(oc.format.type).toBe("json_schema");
    expect(lastBody).not.toHaveProperty("temperature");
    const userMsg = JSON.stringify(lastBody.messages);
    expect(userMsg).toContain("<site_content>");
    expect(userMsg).toContain("工務店");
  });

  it("断られた場合は簡易レポートに切り替える", async () => {
    mode = "refusal";
    const r = await generateReport(audit, {});
    expect(r.source).toBe("template");
    expect(r.note).toContain("控えた");
  });

  it("APIエラー時も簡易レポートを返す", async () => {
    mode = "error";
    const r = await generateReport(audit, {});
    expect(r.source).toBe("template");
  });
});
