import * as cheerio from "cheerio";
import { CATEGORY_META, type AuditResult, type CategoryId, type Check, type PageSpeedError, type PageSpeedResult, type SiteFacts } from "./types";

/**
 * 取得したHTMLをルールで診断する（AIは使わない）。
 * スコアの判定はすべてここで行い、AIには「説明文」だけを任せる。
 * こうすることで、AIの思い込みでスコアが変わることを防ぐ。
 */

export interface AnalyzeInput {
  html: string;
  inputUrl: string;
  finalUrl: string;
  responseMs: number;
  htmlBytes: number;
  pagespeed: PageSpeedResult | PageSpeedError;
  now?: Date;
}

const SNS_PATTERNS: [string, RegExp][] = [
  ["Instagram", /instagram\.com/i],
  ["X (Twitter)", /(?:twitter\.com|\/\/x\.com)/i],
  ["Facebook", /facebook\.com/i],
  ["YouTube", /(?:youtube\.com|youtu\.be)/i],
  ["LINE", /(?:line\.me|lin\.ee)/i],
  ["TikTok", /tiktok\.com/i],
  ["note", /note\.com/i],
];

const CONTACT_RE = /お問い?合わ?せ|お問合せ|問合せ|contact|inquiry|toiawase|ご相談|お見積|見積り?依頼|フォーム/i;
const CTA_RE = /お問い?合わ?せ|お問合せ|資料請求|無料相談|ご相談|見積|予約|申し?込|LINE|電話する|今すぐ|無料体験|無料診断/i;
const COMPANY_RE = /会社概要|会社案内|企業情報|企業概要|会社情報|運営会社|事業者情報|店舗情報|医院案内|事務所案内|アクセス|about|company|corporate|profile/i;
const PRIVACY_RE = /プライバシー|個人情報|privacy/i;
const GENERIC_TITLE_RE = /^(home|top|index|トップ|トップページ|ホーム|無題|untitled|新しいページ)$/i;

export function analyzeHtml(input: AnalyzeInput): AuditResult {
  const now = input.now ?? new Date();
  const $ = cheerio.load(input.html);
  const checks: Check[] = [];

  // ---------- 事実の抽出 ----------
  const title = clean($("title").first().text());
  const description = clean($('meta[name="description" i]').attr("content") ?? "");
  const h1 = $("h1")
    .map((_, el) => clean($(el).text()) || clean($(el).find("img").attr("alt") ?? ""))
    .get()
    .filter(Boolean)
    .slice(0, 5);
  const h1Count = $("h1").length;
  const headings = $("h2, h3")
    .map((_, el) => clean($(el).text()))
    .get()
    .filter((t) => t && t.length <= 80)
    .slice(0, 15);

  const links = $("a")
    .map((_, el) => ({
      text: clean($(el).text()) || clean($(el).find("img").attr("alt") ?? "") || clean($(el).attr("title") ?? ""),
      href: ($(el).attr("href") ?? "").trim(),
    }))
    .get();

  const navLinks = unique(
    $("header a, nav a")
      .map((_, el) => clean($(el).text()))
      .get()
      .filter((t) => t && t.length <= 20),
  ).slice(0, 25);

  const rawHtml = input.html;
  $("script, style, noscript, svg, template, iframe").remove();
  const bodyText = clean($("body").text() || $.root().text());

  const phoneNumbers = extractPhones(bodyText);
  const telLinks = links.filter((l) => /^tel:/i.test(l.href));
  const latestDate = extractLatestDate(bodyText, $, now);
  const copyrightYear = extractCopyrightYear(bodyText + " " + rawHtml.slice(-20000));
  const snsFound = SNS_PATTERNS.filter(([, re]) => links.some((l) => re.test(l.href))).map(([name]) => name);

  const facts: SiteFacts = {
    title,
    description,
    h1,
    headings,
    navLinks,
    phoneNumbers: phoneNumbers.slice(0, 3),
    latestDate: latestDate ? toYmd(latestDate) : null,
    copyrightYear,
    snsFound,
    textExcerpt: bodyText.slice(0, 2500),
  };

  const add = (c: Check) => checks.push(c);

  // ---------- スマホ対応・表示速度（25点） ----------
  const viewport = $('meta[name="viewport" i]').attr("content") ?? "";
  if (/width\s*=\s*device-width/i.test(viewport)) {
    add(ck("viewport", "mobile", "スマホ表示への対応", "pass", 8, 8,
      "スマホの画面幅に合わせて表示する設定があります。",
      "スマホからの来訪者にも読みやすい状態です。",
      "このままで問題ありません。"));
  } else if (viewport) {
    add(ck("viewport", "mobile", "スマホ表示への対応", "warn", 4, 8,
      "スマホ向けの表示設定はありますが、画面幅に合わせる指定になっていません。",
      "スマホで文字が小さく表示され、読みにくい可能性があります。",
      "表示設定（viewport）を「width=device-width」に直し、スマホで実際に確認します。"));
  } else {
    add(ck("viewport", "mobile", "スマホ表示への対応", "fail", 0, 8,
      "スマホ向けの表示設定が見つかりませんでした。",
      "今はホームページを見る人の多くがスマホです。拡大しないと読めないサイトは、すぐに閉じられてしまいます。Googleの検索順位でも不利になります。",
      "スマホ対応（レスポンシブデザイン）へのリニューアルを検討します。"));
  }

  if (input.pagespeed.ok) {
    const perf = input.pagespeed.performance;
    const score = Math.round(12 * clamp((perf - 20) / 70, 0, 1));
    const lcp = input.pagespeed.lcpMs;
    const lcpText = lcp ? `（メインの内容が表示されるまで約${(lcp / 1000).toFixed(1)}秒）` : "";
    add(ck("speed", "mobile", "スマホでの表示速度", perf >= 90 ? "pass" : perf >= 50 ? "warn" : "fail", score, 12,
      `Googleの計測でスマホ表示の速度は100点中${perf}点でした${lcpText}。`,
      perf >= 90
        ? "表示が速く、来訪者を待たせていません。"
        : "表示に時間がかかるほど、見る前に離脱する人が増えます。特に広告やGoogleマップから来た人は待ってくれません。",
      perf >= 90 ? "このままで問題ありません。" : "画像の圧縮、不要なプログラムの削除、サーバーの見直しで改善できることが多いです。"));
  } else {
    const ms = input.responseMs;
    const [status, score] = ms < 1000 ? (["pass", 10] as const) : ms < 2500 ? (["warn", 6] as const) : (["fail", 2] as const);
    add(ck("speed", "mobile", "表示速度（簡易計測）", status, score, 12,
      `ページの取得に約${(ms / 1000).toFixed(1)}秒かかりました。※Googleの詳細計測は利用できなかったため簡易計測です（${input.pagespeed.reason}）。`,
      status === "pass" ? "サーバーの応答は速い方です。" : "表示に時間がかかるほど、見る前に離脱する人が増えます。",
      status === "pass" ? "詳しくはGoogle PageSpeed Insightsでも確認できます。" : "サーバーや画像サイズの見直しを検討します。"));
  }

  const legacy: string[] = [];
  if ($("frameset, frame").length) legacy.push("フレーム構造");
  if ($("font").length) legacy.push("古い文字装飾タグ");
  if ($("marquee, blink").length) legacy.push("流れる文字");
  if (/\.swf\b/i.test(rawHtml)) legacy.push("Flash");
  if ($("center").length) legacy.push("古い中央寄せタグ");
  if (/(?:Internet Explorer|IE\s?\d+).{0,12}推奨|推奨ブラウザ.{0,20}Internet Explorer/i.test(bodyText)) legacy.push("Internet Explorer推奨の記載");
  if (legacy.length === 0) {
    add(ck("legacy", "mobile", "古い作り方が残っていないか", "pass", 5, 5,
      "古い時代の作り方は見つかりませんでした。",
      "最近のブラウザで正しく表示される作りです。",
      "このままで問題ありません。"));
  } else {
    add(ck("legacy", "mobile", "古い作り方が残っていないか", legacy.length >= 2 ? "fail" : "warn", legacy.length >= 2 ? 0 : 2, 5,
      `古い時代の作り方が見つかりました：${legacy.join("、")}。`,
      "10年以上前の作り方が残っていると、スマホで崩れたり「古い会社」という印象を与えたりします。",
      "部分修正よりも、今の基準でのリニューアルの方が結果的に安く済むことが多いです。"));
  }

  // ---------- 検索での見つかりやすさ（20点） ----------
  if (!title) {
    add(ck("title", "seo", "ページタイトル", "fail", 0, 5,
      "ページのタイトルが設定されていません。",
      "Googleの検索結果に表示される「見出し」です。無いと検索で見つけてもらえません。",
      "「地域名＋業種＋会社名」のような、探す人が入力する言葉を入れたタイトルにします。"));
  } else if (GENERIC_TITLE_RE.test(title)) {
    add(ck("title", "seo", "ページタイトル", "warn", 2, 5,
      `タイトルが「${title}」だけになっています。`,
      "検索結果で何の会社か伝わらず、クリックされにくくなります。",
      "「地域名＋業種＋会社名」のような具体的なタイトルにします。"));
  } else if (title.length < 8 || title.length > 60) {
    add(ck("title", "seo", "ページタイトル", "warn", 3, 5,
      `タイトルは「${truncate(title, 50)}」（${title.length}文字）です。`,
      title.length < 8 ? "短すぎて、何のサイトか検索結果で伝わりにくい状態です。" : "長すぎて、検索結果で後半が切れてしまいます。",
      "30文字前後で、地域名・業種・強みが伝わるタイトルにします。"));
  } else {
    add(ck("title", "seo", "ページタイトル", "pass", 5, 5,
      `タイトルは「${truncate(title, 50)}」です。`,
      "検索結果で内容が伝わる長さです。",
      "地域名や業種が入っているか、改めて確認するとさらに効果的です。"));
  }

  if (!description) {
    add(ck("description", "seo", "検索結果の説明文", "fail", 0, 5,
      "検索結果に表示される説明文（メタディスクリプション）が設定されていません。",
      "Googleが本文を勝手に切り取って表示するため、魅力が伝わらずクリックされにくくなります。",
      "強み・地域・対応内容を80〜120文字程度でまとめた説明文を設定します。"));
  } else if (description.length < 30 || description.length > 160) {
    add(ck("description", "seo", "検索結果の説明文", "warn", description.length < 30 ? 2 : 3, 5,
      `説明文は${description.length}文字です。`,
      description.length < 30 ? "短すぎて、検索結果で魅力を伝えきれていません。" : "長すぎて、検索結果で途中から切れてしまいます。",
      "80〜120文字程度で、強みと行動のきっかけ（無料相談など）を入れます。"));
  } else {
    add(ck("description", "seo", "検索結果の説明文", "pass", 5, 5,
      `説明文が設定されています（${description.length}文字）。`,
      "検索結果で内容が伝わりやすい状態です。",
      "このままで問題ありません。"));
  }

  if (h1Count === 0) {
    add(ck("h1", "seo", "ページの大見出し", "fail", 0, 4,
      "ページの大見出し（h1）が見つかりませんでした。",
      "Googleが「このページは何についてのページか」を理解しにくくなります。",
      "「〇〇市の△△なら□□」のように、ページの主題を表す大見出しを1つ置きます。"));
  } else if (h1.length === 0) {
    add(ck("h1", "seo", "ページの大見出し", "warn", 2, 4,
      "大見出しはありますが、中身が画像だけで文字情報がありません。",
      "Googleが見出しの内容を読み取れません。",
      "画像に説明（alt）を付けるか、見出しを文字にします。"));
  } else if (h1Count > 2) {
    add(ck("h1", "seo", "ページの大見出し", "warn", 2, 4,
      `大見出しが${h1Count}個あります。`,
      "主題がぼやけ、Googleに伝わりにくくなります。",
      "大見出しは1ページに1つにし、ほかは小見出しにします。"));
  } else {
    add(ck("h1", "seo", "ページの大見出し", "pass", 4, 4,
      `大見出しは「${truncate(h1[0], 40)}」です。`,
      "ページの主題がGoogleに伝わる状態です。",
      "見出しに地域名や業種が入っているとさらに効果的です。"));
  }

  const imgs = $("img");
  const imgCount = imgs.length;
  const withAlt = imgs.filter((_, el) => clean($(el).attr("alt") ?? "").length > 0).length;
  const altRate = imgCount ? withAlt / imgCount : 1;
  add(ck("alt", "seo", "画像の説明文（alt）", altRate >= 0.8 ? "pass" : altRate >= 0.5 ? "warn" : "fail", altRate >= 0.8 ? 3 : altRate >= 0.5 ? 2 : 0, 3,
    imgCount ? `画像${imgCount}枚のうち、${withAlt}枚に説明文があります（${Math.round(altRate * 100)}%）。` : "画像はありませんでした。",
    altRate >= 0.8 ? "画像の内容がGoogleに伝わる状態です。" : "画像の内容がGoogleに伝わらず、画像検索からの集客を逃しています。",
    altRate >= 0.8 ? "このままで問題ありません。" : "主要な画像に「何が写っているか」の説明文を付けます。"));

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  const ogCount = (ogTitle ? 1 : 0) + (ogImage ? 1 : 0);
  add(ck("ogp", "seo", "SNSでシェアされたときの表示", ogCount === 2 ? "pass" : ogCount === 1 ? "warn" : "fail", ogCount === 2 ? 3 : ogCount === 1 ? 1 : 0, 3,
    ogCount === 2 ? "LINEやSNSでシェアされたときのタイトルと画像が設定されています。" : ogCount === 1 ? "シェア用の設定が一部だけあります。" : "LINEやSNSでシェアされたときの表示設定（OGP）がありません。",
    ogCount === 2 ? "紹介されたときに見栄えよく表示されます。" : "LINEでURLを送ったときに画像が出ず、紹介や口コミで広がりにくくなります。",
    ogCount === 2 ? "このままで問題ありません。" : "シェア用のタイトル・説明・画像（OGP）を設定します。"));

  // ---------- 信頼・安心感（20点） ----------
  const isHttps = input.finalUrl.startsWith("https://");
  add(ck("https", "trust", "通信の暗号化（SSL）", isHttps ? "pass" : "fail", isHttps ? 10 : 0, 10,
    isHttps ? "通信が暗号化（https）されています。" : "通信が暗号化されていません（httpのまま）。",
    isHttps ? "ブラウザに「保護されていない通信」と表示されず、安心して閲覧できます。" : "ブラウザのアドレス欄に「保護されていない通信」と表示され、問い合わせフォームへの入力をためらわれます。Googleの評価も下がります。",
    isHttps ? "このままで問題ありません。" : "SSL証明書を導入します。今は無料で導入できる場合も多いです。"));

  const hasCompany = links.some((l) => COMPANY_RE.test(l.text) || COMPANY_RE.test(l.href));
  add(ck("company", "trust", "会社・店舗情報のページ", hasCompany ? "pass" : "fail", hasCompany ? 4 : 0, 4,
    hasCompany ? "会社概要やアクセスなどのページへのリンクがあります。" : "会社概要・店舗情報へのリンクが見つかりませんでした。",
    hasCompany ? "どんな会社かを確認でき、安心感につながります。" : "初めての人は「どんな会社か」を必ず確認します。見つからないと不安になり、問い合わせをやめてしまいます。",
    hasCompany ? "代表者の写真や想いを載せると、さらに信頼感が増します。" : "会社概要（所在地・代表者・沿革など）のページを作り、全ページからリンクします。"));

  const hasPrivacy = links.some((l) => PRIVACY_RE.test(l.text) || PRIVACY_RE.test(l.href));
  add(ck("privacy", "trust", "個人情報の取り扱い", hasPrivacy ? "pass" : "warn", hasPrivacy ? 3 : 0, 3,
    hasPrivacy ? "プライバシーポリシーへのリンクがあります。" : "プライバシーポリシー（個人情報の取り扱い）へのリンクが見つかりませんでした。",
    hasPrivacy ? "問い合わせ時の安心材料になっています。" : "フォームで名前や電話番号を入力してもらう以上、取り扱いの明記は信頼の基本です。",
    hasPrivacy ? "このままで問題ありません。" : "プライバシーポリシーのページを用意し、フォームの近くにもリンクします。"));

  const thisYear = now.getFullYear();
  const hasCopyrightMark = /©|&copy;|copyright/i.test(bodyText) || /&copy;|©/.test(rawHtml.slice(-20000));
  if (copyrightYear === null && hasCopyrightMark) {
    add(ck("copyright", "trust", "サイトが管理されている印象", "pass", 3, 3,
      "著作権表記があります（年の記載なし）。",
      "年を書かない表記なので、古い印象を与える心配はありません。",
      "このままで問題ありません。"));
  } else if (copyrightYear === null) {
    add(ck("copyright", "trust", "サイトが管理されている印象", "warn", 1, 3,
      "著作権表記（© 年）が見つかりませんでした。",
      "サイトが今も管理されているか、来訪者が判断しにくい状態です。",
      `フッターに「© ${thisYear} 会社名」のような表記を入れ、毎年自動で更新されるようにします。`));
  } else if (copyrightYear >= thisYear - 1) {
    add(ck("copyright", "trust", "サイトが管理されている印象", "pass", 3, 3,
      `著作権表記は${copyrightYear}年です。`,
      "サイトが管理されている印象を与えています。",
      "このままで問題ありません。"));
  } else {
    const old = thisYear - copyrightYear;
    add(ck("copyright", "trust", "サイトが管理されている印象", old >= 4 ? "fail" : "warn", old >= 4 ? 0 : 1, 3,
      `著作権表記が${copyrightYear}年のままです（${old}年前）。`,
      "「このサイトは放置されている＝この会社は大丈夫？」という印象を与えることがあります。",
      "表記を自動で今年になるようにし、あわせて古い情報がないか見直します。"));
  }

  // ---------- 問い合わせへの導線（25点） ----------
  if (telLinks.length > 0) {
    add(ck("tel", "conversion", "スマホから電話できるか", "pass", 7, 7,
      "電話番号をタップするとそのまま電話できる設定があります。",
      "スマホから見た人が、迷わずすぐに電話できます。",
      "このままで問題ありません。"));
  } else if (phoneNumbers.length > 0) {
    add(ck("tel", "conversion", "スマホから電話できるか", "warn", 4, 7,
      `電話番号（${phoneNumbers[0]}）は書かれていますが、タップしても電話がかかりません。`,
      "スマホで見た人は番号をメモして打ち直す必要があり、その手間で電話をやめてしまう人がいます。",
      "電話番号をタップで発信できるリンクにします（数分でできる修正です）。"));
  } else {
    add(ck("tel", "conversion", "スマホから電話できるか", "fail", 0, 7,
      "トップページに電話番号が見つかりませんでした。",
      "「すぐ話を聞きたい」という一番熱い見込み客を逃しています。",
      "ページ上部と下部に、タップで発信できる電話番号を置きます。"));
  }

  const hasForm = $("form").filter((_, el) => $(el).find("textarea, input[type=email]").length > 0).length > 0;
  const hasContactLink = links.some((l) => CONTACT_RE.test(l.text) || CONTACT_RE.test(l.href));
  add(ck("contact", "conversion", "問い合わせフォーム", hasForm || hasContactLink ? "pass" : "fail", hasForm || hasContactLink ? 8 : 0, 8,
    hasForm ? "ページ内に問い合わせフォームがあります。" : hasContactLink ? "問い合わせページへのリンクがあります。" : "問い合わせフォーム・ページへのリンクが見つかりませんでした。",
    hasForm || hasContactLink ? "電話が苦手な人や営業時間外でも、問い合わせを受け取れます。" : "夜間や休日にサイトを見た人、電話が苦手な人からの問い合わせをすべて逃しています。",
    hasForm || hasContactLink ? "入力項目を減らすと、問い合わせ数がさらに増えることが多いです。" : "入力項目の少ない問い合わせフォームを用意し、各ページから案内します。"));

  const ctaCount = links.filter((l) => CTA_RE.test(l.text)).length + $("button").filter((_, el) => CTA_RE.test(clean($(el).text()))).length;
  add(ck("cta", "conversion", "行動を促すボタン", ctaCount >= 3 ? "pass" : ctaCount >= 1 ? "warn" : "fail", ctaCount >= 3 ? 5 : ctaCount >= 1 ? 3 : 0, 5,
    ctaCount ? `「お問い合わせ」「無料相談」などのボタン・リンクが${ctaCount}か所あります。` : "「お問い合わせ」「無料相談」などの、行動を促すボタンが見つかりませんでした。",
    ctaCount >= 3 ? "読み進めた人が、自然に問い合わせへ進めます。" : "興味を持った人が「次に何をすればいいか」迷い、そのまま帰ってしまいます。",
    ctaCount >= 3 ? "ボタンの文言を「無料で相談する」など具体的にすると、さらに効果的です。" : "ページの上・中・下に「無料相談はこちら」などのボタンを置きます。"));

  const hasAddress = /〒\s?\d{3}[-ー－‐]?\d{4}/.test(bodyText) || /(東京都|北海道|(?:京都|大阪)府|[^\s]{2,3}県)[^\s]{1,8}(市|区|郡|町|村)/.test(bodyText);
  const hasHours = /営業時間|受付時間|診療時間|定休日|営業日|休業日/.test(bodyText);
  const infoCount = (hasAddress ? 1 : 0) + (hasHours ? 1 : 0);
  add(ck("access", "conversion", "所在地・営業時間の表示", infoCount === 2 ? "pass" : infoCount === 1 ? "warn" : "fail", infoCount === 2 ? 5 : infoCount === 1 ? 3 : 0, 5,
    infoCount === 2 ? "所在地と営業時間（受付時間）が載っています。" : infoCount === 1 ? `${hasAddress ? "所在地" : "営業時間"}は載っていますが、${hasAddress ? "営業時間・受付時間" : "所在地"}が見当たりません。` : "トップページに所在地・営業時間が見当たりません。",
    infoCount === 2 ? "「いつ・どこに連絡すればいいか」がすぐ分かります。" : "「今電話していいのか」「近いのか」が分からず、問い合わせをためらう原因になります。",
    infoCount === 2 ? "このままで問題ありません。" : "ページ下部に、所在地・営業時間・定休日をまとめて載せます。"));

  // ---------- 情報の新しさ・発信（10点） ----------
  if (!latestDate) {
    add(ck("updated", "freshness", "最近の更新", "warn", 2, 6,
      "日付の入ったお知らせ・ブログが見当たりませんでした。",
      "「今も営業しているか」「活発な会社か」が伝わりにくい状態です。",
      "月1回でも、お知らせや施工事例・お客様の声を日付付きで更新します。"));
  } else {
    const days = Math.floor((now.getTime() - latestDate.getTime()) / 86400000);
    const [status, score] = days <= 90 ? (["pass", 6] as const) : days <= 365 ? (["warn", 3] as const) : (["fail", 0] as const);
    add(ck("updated", "freshness", "最近の更新", status, score, 6,
      `ページ内で一番新しい日付は${toYmd(latestDate)}です（約${days < 60 ? `${days}日` : `${Math.round(days / 30)}か月`}前）。`,
      status === "pass" ? "最近も情報発信されており、活発な印象です。" : "更新が止まっていると「この会社は今もやっている？」と不安に思われることがあります。",
      status === "pass" ? "このペースを続けると、検索評価にも良い影響があります。" : "お知らせ・事例・ブログなどを定期的に更新できる仕組みを作ります。"));
  }

  add(ck("sns", "freshness", "SNSとの連携", snsFound.length ? "pass" : "warn", snsFound.length ? 4 : 0, 4,
    snsFound.length ? `SNSへのリンクがあります（${snsFound.join("、")}）。` : "SNSへのリンクが見つかりませんでした。",
    snsFound.length ? "サイト以外でも会社の雰囲気が伝わり、ファンになってもらいやすくなります。" : "最近は、サイトを見た後にSNSで雰囲気を確認する人が増えています。",
    snsFound.length ? "SNSの最新投稿をサイトに表示すると、更新の手間なく新しさを出せます。" : "業種に合うSNS（Instagram、LINE公式アカウントなど）を1つ始め、サイトからリンクします。"));

  // ---------- 集計 ----------
  const categories = (Object.keys(CATEGORY_META) as CategoryId[]).map((id) => ({
    id,
    label: CATEGORY_META[id].label,
    score: checks.filter((c) => c.category === id).reduce((s, c) => s + c.score, 0),
    max: CATEGORY_META[id].max,
  }));
  const totalScore = categories.reduce((s, c) => s + c.score, 0);

  return {
    inputUrl: input.inputUrl,
    finalUrl: input.finalUrl,
    fetchedAt: now.toISOString(),
    responseMs: input.responseMs,
    htmlBytes: input.htmlBytes,
    totalScore,
    grade: gradeOf(totalScore),
    categories,
    checks,
    pagespeed: input.pagespeed,
    facts,
  };
}

export function gradeOf(score: number): AuditResult["grade"] {
  if (score >= 90) return "S";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  if (score >= 45) return "C";
  return "D";
}

// ---------- 補助関数 ----------

function ck(
  id: string, category: CategoryId, label: string, status: Check["status"], score: number, maxScore: number,
  finding: string, impact: string, fix: string,
): Check {
  return { id, category, label, status, score, maxScore, finding, impact, fix };
}

function clean(s: string): string {
  return s.replace(/[\s　]+/g, " ").trim();
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function extractPhones(text: string): string[] {
  const normalized = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const re = /(?<!\d)(0\d{1,4})[\s\-‐−ー－(（)）.]{0,2}(\d{1,4})[\s\-‐−ー－)）.]{0,2}(\d{3,4})(?!\d)/g;
  const found: string[] = [];
  for (const m of normalized.matchAll(re)) {
    const digits = m[1] + m[2] + m[3];
    if (digits.length < 10 || digits.length > 11) continue;
    if (/^0{2}/.test(digits)) continue;
    found.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return unique(found);
}

export function extractLatestDate(text: string, $: cheerio.CheerioAPI, now: Date): Date | null {
  const candidates: Date[] = [];
  // 未来の日付（イベント予定など）は「更新日」ではないので除外する（時差を考慮して1日の余裕）
  const limit = now.getTime() + 86400000;
  const push = (y: number, m: number, d: number) => {
    if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return;
    const date = new Date(y, m - 1, d);
    if (date.getMonth() !== m - 1) return;
    if (date.getTime() > limit) return;
    candidates.push(date);
  };
  const normalized = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  for (const m of normalized.matchAll(/(20\d{2})\s*[年./\-]\s*(\d{1,2})\s*[月./\-]\s*(\d{1,2})/g)) {
    push(+m[1], +m[2], +m[3]);
  }
  for (const m of normalized.matchAll(/令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    const r = m[1] === "元" ? 1 : +m[1];
    push(2018 + r, +m[2], +m[3]);
  }
  $("time[datetime]").each((_, el) => {
    const v = $(el).attr("datetime") ?? "";
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) push(+m[1], +m[2], +m[3]);
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a > b ? a : b));
}

export function extractCopyrightYear(text: string): number | null {
  const re = /(?:©|&copy;|\(c\)|copyright)[^0-9]{0,30}((?:19|20)\d{2})(?:\s*[-–~〜－]\s*((?:19|20)\d{2}))?/gi;
  let best: number | null = null;
  for (const m of text.matchAll(re)) {
    const y = Math.max(+m[1], m[2] ? +m[2] : 0);
    if (best === null || y > best) best = y;
  }
  return best;
}
