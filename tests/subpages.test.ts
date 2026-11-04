import { describe, expect, it } from "vitest";
import { analyzeHtml, findSubpageLinks, hasAddressText, hasHoursText } from "@/lib/audit";
import { detectIndustry, resolveIndustry } from "@/lib/industry";
import { templateReport } from "@/lib/report";

const NOW = new Date(2026, 10, 2);
const ps = { ok: false as const, reason: "テスト" };

const TOP = `<html><head><meta name="viewport" content="width=device-width"><title>大阪市港区のさくら歯科｜インプラント・矯正</title></head><body>
<h1>さくら歯科</h1>
<nav><a href="/clinic/">医院案内</a><a href="/contact/">お問い合わせ</a><a href="https://other.example.com/about">外部</a><a href="tel:0612345678">電話</a></nav>
<p>虫歯・歯周病・予防歯科・ホワイトニング</p>
</body></html>`;

const COMPANY = `<html><body><h1>医院案内</h1><table>
<tr><th>院長</th><td>山田花子</td></tr><tr><th>開院</th><td>2010年</td></tr>
<tr><th>所在地</th><td>〒552-0001 大阪府大阪市港区波除1-2-3</td></tr><tr><th>診療時間</th><td>9:00〜18:00</td></tr>
<tr><th>診療内容</th><td>一般歯科</td></tr></table><a href="/privacy/">個人情報保護方針</a></body></html>`;

const CONTACT_NO_FORM = `<html><body><h1>お問い合わせ</h1><p>メール: info@example.com</p></body></html>`;

describe("下層ページ", () => {
  it("同じサイト内の会社概要とお問い合わせを見つける（外部サイトは無視）", () => {
    const links = findSubpageLinks(TOP, "https://www.example.com/");
    expect(links).toEqual([
      { kind: "company", url: "https://www.example.com/clinic/" },
      { kind: "contact", url: "https://www.example.com/contact/" },
    ]);
  });

  it("下層ページの情報を診断に反映する", () => {
    const r = analyzeHtml({
      html: TOP, inputUrl: "https://www.example.com/", finalUrl: "https://www.example.com/", responseMs: 500, htmlBytes: TOP.length, pagespeed: ps, now: NOW,
      subpages: [
        { kind: "company", url: "https://www.example.com/clinic/", html: COMPANY },
        { kind: "contact", url: "https://www.example.com/contact/", html: CONTACT_NO_FORM },
      ],
    });
    const get = (id: string) => r.checks.find((c) => c.id === id)!;
    expect(get("company").status).toBe("pass");
    expect(get("privacy").status).toBe("pass");
    expect(get("privacy").finding).toContain("会社概要");
    expect(get("contact").status).toBe("warn"); // ページはあるがフォームが無い
    expect(get("access").score).toBe(4); // 下層ページにだけある
    expect(r.pagesChecked.map((p) => p.kind)).toEqual(["top", "company", "contact"]);
    expect(r.industry.id).toBe("dental");
    expect(r.facts.subpageExcerpt).toContain("院長");
  });
});

describe("実在サイトで見つかった誤判定の修正", () => {
  const run = (html: string) =>
    analyzeHtml({ html, inputUrl: "https://a.example.com/", finalUrl: "https://a.example.com/", responseMs: 500, htmlBytes: html.length, pagespeed: ps, now: NOW });

  it("viewportが2つある場合は最後のものを見る", () => {
    const r = run(`<html><head><meta name="viewport" content="width=1100"><meta name="viewport" content="width=device-width"></head><body></body></html>`);
    expect(r.checks.find((c) => c.id === "viewport")!.status).toBe("pass");
  });

  it("JavaScriptでタップ発信にしている電話番号はOK", () => {
    const r = run(`<html><body><span data-action="call">042-673-7094</span></body></html>`);
    expect(r.checks.find((c) => c.id === "tel")!.status).toBe("pass");
  });

  it("画像の中だけの電話番号を見分ける", () => {
    const r = run(`<html><body><img src="a.png" alt="Tel:06-6584-2525 〒552-0002 大阪市港区"></body></html>`);
    const tel = r.checks.find((c) => c.id === "tel")!;
    expect(tel.status).toBe("warn");
    expect(tel.finding).toContain("画像");
  });

  it("/form へのリンクと「相談してみる」を問い合わせ導線として数える", () => {
    const r = run(`<html><body><a href="/form">相談してみる</a></body></html>`);
    expect(r.checks.find((c) => c.id === "contact")!.status).toBe("pass");
    expect(r.checks.find((c) => c.id === "cta")!.score).toBeGreaterThan(0);
  });

  it("住所・営業時間のいろいろな書き方", () => {
    expect(hasAddressText("京都市 中京区 三条")).toBe(true);
    expect(hasAddressText("白岡市新白岡4−15−5")).toBe(true);
    expect(hasAddressText("お気軽にどうぞ")).toBe(false);
    expect(hasHoursText("休診日：日曜・祝日")).toBe(true);
    expect(hasHoursText("9:00〜18:00")).toBe(true);
  });
});

describe("業種", () => {
  it("サイトの文字から業種を推定する", () => {
    const d = (title: string) => detectIndustry({ title, description: "", h1: [], headings: [], text: "" });
    expect(d("注文住宅とリフォームの山田工務店").id).toBe("construction");
    expect(d("大津市の税理士事務所｜相続・確定申告").id).toBe("professional");
    expect(d("株式会社田中製作所｜精密切削加工").id).toBe("manufacturing");
    expect(d("ようこそ").id).toBe("other");
  });

  it("営業担当の入力を優先する", () => {
    expect(resolveIndustry("焼肉店", { id: "dental", label: "歯科医院" }).profile.id).toBe("restaurant");
    expect(resolveIndustry("", { id: "dental", label: "歯科医院" }).profile.id).toBe("dental");
    const r = resolveIndustry("ペットショップ", { id: "dental", label: "歯科医院" });
    expect(r.profile.id).toBe("other");
    expect(r.label).toBe("ペットショップ");
  });

  it("テンプレート版の営業メモが業種に合わせて変わる", () => {
    const audit = analyzeHtml({ html: TOP, inputUrl: "https://www.example.com/", finalUrl: "https://www.example.com/", responseMs: 500, htmlBytes: 1, pagespeed: ps, now: NOW });
    const dental = templateReport(audit, {});
    expect(dental.industryLabel).toBe("歯科医院");
    expect(dental.salesMemo.hearingQuestions.some((q) => q.question.includes("患者"))).toBe(true);
    const mfg = templateReport(audit, { industry: "金属加工" });
    expect(mfg.salesMemo.proposalAngles.some((a) => a.title.includes("加工事例"))).toBe(true);
  });
});
