import { describe, expect, it } from "vitest";
import { analyzeHtml, extractCopyrightYear, extractPhones, gradeOf } from "@/lib/audit";
import { templateReport } from "@/lib/report";

const NOW = new Date(2026, 10, 2); // 2026-11-02

const GOOD_HTML = `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>横浜市の注文住宅なら山田工務店｜自然素材の家づくり</title>
<meta name="description" content="横浜市・川崎市で注文住宅を手がける山田工務店です。自然素材を使った健康的な家づくりと、建てた後も安心の30年保証。無料相談・見学会を随時受付中です。">
<meta property="og:title" content="山田工務店"><meta property="og:image" content="https://example.com/og.png">
</head><body>
<header><nav><a href="/about">会社概要</a><a href="/works">施工事例</a><a href="/contact">お問い合わせ</a></nav></header>
<h1>横浜で、自然素材の注文住宅を。</h1>
<img src="a.jpg" alt="施工事例の外観"><img src="b.jpg" alt="リビング">
<a href="tel:0451234567">045-123-4567</a>
<a href="/contact">無料相談はこちら</a><a href="/reserve">見学会を予約する</a>
<section><h2>お知らせ</h2><p>2026.10.20 秋の見学会を開催します</p></section>
<p>〒220-0011 神奈川県横浜市西区高島1-1-1 営業時間 9:00〜18:00 定休日 水曜</p>
<a href="https://www.instagram.com/yamada">Instagram</a>
<a href="/privacy">プライバシーポリシー</a>
<footer>© 2026 山田工務店</footer>
</body></html>`;

const BAD_HTML = `<html><head><title>トップページ</title></head><body>
<center><font size="5">ようこそ</font></center>
<table><tr><td><img src="x.gif"><img src="y.gif"></td></tr></table>
<p>更新 2019年4月1日</p>
<p>Copyright (c) 2015 Some Company</p>
</body></html>`;

const psFail = { ok: false as const, reason: "テスト" };

describe("analyzeHtml", () => {
  it("整ったサイトは高得点になる", () => {
    const r = analyzeHtml({
      html: GOOD_HTML,
      inputUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      responseMs: 400,
      htmlBytes: GOOD_HTML.length,
      pagespeed: { ok: true, performance: 92, lcpMs: 1800, cls: 0.01, tbtMs: 50, fcpMs: 900 },
      now: NOW,
    });
    expect(r.totalScore).toBeGreaterThanOrEqual(90);
    expect(r.grade).toBe("S");
    expect(r.checks.filter((c) => c.status === "fail")).toHaveLength(0);
    expect(r.facts.latestDate).toBe("2026年10月20日");
    expect(r.facts.copyrightYear).toBe(2026);
    expect(r.facts.snsFound).toContain("Instagram");
  });

  it("古いサイトの問題点を検出する", () => {
    const r = analyzeHtml({
      html: BAD_HTML,
      inputUrl: "http://old.example.com/",
      finalUrl: "http://old.example.com/",
      responseMs: 3200,
      htmlBytes: BAD_HTML.length,
      pagespeed: psFail,
      now: NOW,
    });
    const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(byId.viewport.status).toBe("fail");
    expect(byId.https.status).toBe("fail");
    expect(byId.title.status).toBe("warn"); // 「トップページ」だけ
    expect(byId.legacy.status).toBe("fail");
    expect(byId.contact.status).toBe("fail");
    expect(byId.tel.status).toBe("fail");
    expect(byId.updated.status).toBe("fail");
    expect(byId.copyright.status).toBe("fail");
    expect(byId.speed.label).toContain("簡易");
    expect(r.totalScore).toBeLessThan(30);
    expect(r.grade).toBe("D");
  });

  it("各分野の満点の合計は100点", () => {
    const r = analyzeHtml({ html: GOOD_HTML, inputUrl: "", finalUrl: "https://a.jp/", responseMs: 1, htmlBytes: 1, pagespeed: psFail, now: NOW });
    expect(r.categories.reduce((s, c) => s + c.max, 0)).toBe(100);
    for (const cat of r.categories) {
      const sumMax = r.checks.filter((c) => c.category === cat.id).reduce((s, c) => s + c.maxScore, 0);
      expect(sumMax).toBe(cat.max);
    }
  });

  it("未来の日付（イベント予定）は更新日として扱わない", () => {
    const html = `<html><body><p>2026.10.01 お知らせ</p><p>2026年12月24日 クリスマス見学会</p></body></html>`;
    const r = analyzeHtml({ html, inputUrl: "", finalUrl: "https://a.jp/", responseMs: 1, htmlBytes: 1, pagespeed: psFail, now: NOW });
    expect(r.facts.latestDate).toBe("2026年10月1日");
  });

  it("年なしの著作権表記は減点しない", () => {
    const html = `<html><body><footer>Copyright © ABC Inc. All Rights Reserved.</footer></body></html>`;
    const r = analyzeHtml({ html, inputUrl: "", finalUrl: "https://a.jp/", responseMs: 1, htmlBytes: 1, pagespeed: psFail, now: NOW });
    expect(r.checks.find((c) => c.id === "copyright")?.status).toBe("pass");
  });

  it("電話番号が書かれているだけの場合は「要改善」", () => {
    const html = `<html><body><p>お電話：０３－１２３４－５６７８</p></body></html>`;
    const r = analyzeHtml({ html, inputUrl: "", finalUrl: "https://a.jp/", responseMs: 1, htmlBytes: 1, pagespeed: psFail, now: NOW });
    expect(r.checks.find((c) => c.id === "tel")?.status).toBe("warn");
  });
});

describe("抽出ヘルパー", () => {
  it("電話番号を抽出する（全角・括弧も対応）", () => {
    expect(extractPhones("TEL 045-123-4567")).toEqual(["045-123-4567"]);
    expect(extractPhones("（０１２０）１２３－４５６")).toEqual(["0120-123-456"]);
    expect(extractPhones("03(1234)5678")).toEqual(["03-1234-5678"]);
    expect(extractPhones("郵便番号 220-0011")).toEqual([]);
  });

  it("著作権表記の年を取得する（範囲表記は新しい方）", () => {
    expect(extractCopyrightYear("© 2010-2024 ABC")).toBe(2024);
    expect(extractCopyrightYear("Copyright(C) 2019 ABC All Rights Reserved.")).toBe(2019);
    expect(extractCopyrightYear("著作権表記なし")).toBeNull();
  });

  it("ランク判定", () => {
    expect(gradeOf(95)).toBe("S");
    expect(gradeOf(75)).toBe("A");
    expect(gradeOf(60)).toBe("B");
    expect(gradeOf(45)).toBe("C");
    expect(gradeOf(10)).toBe("D");
  });
});

describe("templateReport", () => {
  it("AIなしでも、レポートと営業メモが一通りそろう", () => {
    const audit = analyzeHtml({ html: BAD_HTML, inputUrl: "", finalUrl: "http://old.example.com/", responseMs: 3000, htmlBytes: 1, pagespeed: psFail, now: NOW });
    const r = templateReport(audit, { product: "ホームページ制作・リニューアル" }, "テスト");
    expect(r.source).toBe("template");
    expect(r.ownerReport.lossPoints.length).toBeGreaterThan(0);
    expect(r.ownerReport.improvements.length).toBeGreaterThanOrEqual(3);
    expect(r.salesMemo.hearingQuestions.length).toBeGreaterThanOrEqual(3);
    expect(r.salesMemo.objections).toHaveLength(3);
    expect(r.ownerReport.improvements[0].priority).toBe("high");
  });
});
