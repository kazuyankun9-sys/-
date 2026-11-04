"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrandSettings, EMPTY_BRAND, loadBrand, PrintFooter, PrintHeader, saveBrand, type Brand } from "@/components/BrandSettings";
import { ScoreRing, scoreColor } from "@/components/ScoreRing";
import { CheckListView, OwnerReportView, ReportSkeleton, SalesMemoView, salesMemoToText } from "@/components/ReportViews";
import type { AuditResult, ReportResult } from "@/lib/types";

type Tab = "owner" | "sales" | "checks";
type Phase = "idle" | "auditing" | "done" | "error";

interface HistoryItem {
  url: string;
  title: string;
  score: number;
  at: string;
  industry: string;
  product: string;
}

const PRODUCTS = [
  "ホームページ制作・リニューアル",
  "ホームページの保守・更新代行",
  "MEO（Googleマップ対策）",
  "SEO（検索順位対策）",
  "Web広告の運用",
  "SNS運用の支援",
  "OA機器・IT環境の導入",
];

const STEPS = ["サイトを読み込み中", "会社概要・お問い合わせページを確認中", "18項目をチェック中", "スマホでの表示速度を計測中"];
const HISTORY_KEY = "sitekarte:history";

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

/** サイトのタイトルから、宛名に使えそうな会社名を取り出す（見つからなければ空） */
function guessCompanyName(title: string): string {
  const parts = title.split(/\s*[|｜]\s*|\s+[-–—]\s+|[：:]/).map((p) => p.trim()).filter(Boolean);
  const re = /株式会社|有限会社|合同会社|合資会社|医療法人|社会福祉法人|一般社団法人|税理士法人|弁護士法人|医院|歯科|クリニック|事務所|工務店|製作所|工業|建設/;
  const hit = parts.find((p) => re.test(p) && p.length <= 30);
  if (!hit) return "";
  // 「〇〇なら△△工務店」のような形は、最後の名前の部分だけにする
  const m = hit.match(/(?:なら|の|は)([^なのは]{2,25})$/);
  return (m && re.test(m[1]) ? m[1] : hit).trim();
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 10)));
  } catch {
    // プライベートモードなどでは保存しない
  }
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [product, setProduct] = useState(PRODUCTS[0]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [report, setReport] = useState<ReportResult | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("owner");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [toast, setToast] = useState("");
  const [brand, setBrand] = useState<Brand>(EMPTY_BRAND);
  const [recipient, setRecipient] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);
  const runId = useRef(0);

  useEffect(() => {
    setHistory(loadHistory());
    setBrand(loadBrand());
  }, []);

  const onBrandChange = (b: Brand) => {
    setBrand(b);
    if (!saveBrand(b)) setToast("この端末には保存できませんでした（容量やプライベートモードの制限）");
  };

  useEffect(() => {
    if (phase !== "auditing") return;
    setStep(0);
    const timers = [setTimeout(() => setStep(1), 1500), setTimeout(() => setStep(2), 3500), setTimeout(() => setStep(3), 5000)];
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const run = useCallback(
    async (targetUrl: string, ind: string, prod: string) => {
      const id = ++runId.current;
      setPhase("auditing");
      setError("");
      setAudit(null);
      setReport(null);
      setTab("owner");

      let result: AuditResult;
      try {
        const res = await fetch("/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: targetUrl }),
        });
        const data = await res.json();
        if (id !== runId.current) return;
        if (!res.ok) {
          setError(data.error ?? "診断に失敗しました。");
          setPhase("error");
          return;
        }
        result = data as AuditResult;
      } catch {
        if (id !== runId.current) return;
        setError("通信エラーが発生しました。インターネット接続を確認してください。");
        setPhase("error");
        return;
      }

      setAudit(result);
      setRecipient(guessCompanyName(result.facts.title));
      setPhase("done");
      const item: HistoryItem = {
        url: targetUrl,
        title: result.facts.title || result.finalUrl,
        score: result.totalScore,
        at: new Date().toISOString(),
        industry: ind,
        product: prod,
      };
      setHistory((prev) => {
        const next = [item, ...prev.filter((h) => h.url !== targetUrl)].slice(0, 10);
        saveHistory(next);
        return next;
      });
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

      setReportLoading(true);
      try {
        const res = await fetch("/api/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audit: result, context: { industry: ind, product: prod } }),
        });
        const data = await res.json();
        if (id !== runId.current) return;
        if (res.ok) setReport(data as ReportResult);
        else setError(data.error ?? "レポートの作成に失敗しました。");
      } catch {
        if (id === runId.current) setError("レポートの作成中に通信エラーが発生しました。");
      } finally {
        if (id === runId.current) setReportLoading(false);
      }
    },
    [],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || phase === "auditing") return;
    run(url.trim(), industry.trim(), product);
  };

  const copyMemo = async () => {
    if (!audit || !report) return;
    try {
      await navigator.clipboard.writeText(salesMemoToText(audit, report));
      setToast("営業メモをコピーしました");
    } catch {
      setToast("コピーできませんでした");
    }
  };

  const printOwner = () => {
    setTab("owner");
    // 保存されるPDFのファイル名は、ページのタイトルになる
    const prevTitle = document.title;
    const name = (recipient.trim() || audit?.facts.title || "").replace(/[\\/:*?"<>|]/g, "").slice(0, 30);
    const d = new Date();
    document.title = `ホームページ診断レポート${name ? `_${name}` : ""}_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const restore = () => {
      document.title = prevTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    setTimeout(() => window.print(), 50);
  };

  const reset = () => {
    runId.current++;
    setPhase("idle");
    setAudit(null);
    setReport(null);
    setError("");
    setUrl("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const issueCount = audit?.checks.filter((c) => c.status !== "pass").length ?? 0;

  return (
    <>
      <header className="site-header">
        <div className="container">
          <a className="brand" href="/" onClick={(e) => { e.preventDefault(); reset(); }}>
            <span className="brand-mark" aria-hidden="true">診</span>
            サイトカルテAI
          </a>
          <span className="badge-beta">試作版</span>
        </div>
      </header>

      <main className="container">
        <section className="hero" hidden={phase === "done"}>
          <span className="hero-eyebrow">中小企業に提案する営業担当のための</span>
          <h1>
            <span className="nowrap">URLを入れるだけ。</span>
            <br />
            <span className="nowrap">社長に伝わる</span>
            <span className="nowrap">診断レポートと、</span>
            <br />
            <span className="nowrap">商談メモを30秒で。</span>
          </h1>
          <p>
            スマホ対応・検索対策・問い合わせ導線など18項目を自動でチェックします。専門用語を使わない改善レポートと、ヒアリング質問や反論への切り返しまでAIが用意します。
          </p>
        </section>

        <form className="card form-card" onSubmit={onSubmit} noValidate>
          <label htmlFor="url" className="field" style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>
              診断するホームページのURL
            </span>
          </label>
          <div className="url-row">
            <input
              id="url"
              className="input input-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="例：example.co.jp"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <button className="btn btn-primary" type="submit" disabled={!url.trim() || phase === "auditing"}>
              {phase === "auditing" ? "診断中…" : "無料で診断する"}
            </button>
          </div>
          <div className="form-options">
            <div className="field">
              <label htmlFor="industry">相手の業種（任意）</label>
              <input
                id="industry"
                className="input"
                placeholder="例：工務店、歯科医院、税理士事務所"
                value={industry}
                maxLength={60}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="product">あなたが提案したい商材</label>
              <select id="product" className="select" value={product} onChange={(e) => setProduct(e.target.value)}>
                {PRODUCTS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="form-note">
            トップページと、会社概要・お問い合わせのページ（最大2ページ）を1回ずつ読み取ります。サイトが自動ツールのアクセスを禁止している場合（robots.txt）は診断しません。
          </p>
          {error && phase !== "done" && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
        </form>

        {phase === "auditing" && (
          <div className="card progress" aria-live="polite">
            <ol>
              {STEPS.map((s, i) => (
                <li key={s} className={i < step ? "done" : i === step ? "active" : ""}>
                  <span className="step-dot">{i < step ? "✓" : ""}</span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="form-note">速度計測に時間がかかる場合があります（最大40秒ほど）。</p>
          </div>
        )}

        {phase === "done" && audit && (
          <div ref={resultRef} style={{ scrollMarginTop: 12 }}>
            <PrintHeader audit={audit} brand={brand} recipient={recipient} />
            <div className="card summary-card">
              <ScoreRing score={audit.totalScore} grade={audit.grade} />
              <div className="site-meta">
                <h2>{audit.facts.title || "（タイトルなし）"}</h2>
                <div className="site-url">{audit.finalUrl}</div>
                <div className="site-tags no-print">
                  <span className="tag tag-neutral">
                    業種：{report?.industryLabel ?? audit.industry?.label ?? "不明"}
                    {(report?.industryLabel ?? audit.industry?.label) === audit.industry?.label && audit.industry?.id !== "other" ? "（自動判定）" : ""}
                  </span>
                  <span className="tag tag-neutral">
                    確認したページ：{(audit.pagesChecked ?? []).map((p) => (p.kind === "top" ? "トップ" : p.kind === "company" ? "会社概要" : "お問い合わせ")).join("・") || "トップ"}
                  </span>
                </div>
                <div className="cat-bars">
                  {audit.categories.map((c) => (
                    <div key={c.id}>
                      <div className="cat-bar-head">
                        <span>{c.label}</span>
                        <span>
                          {c.score} / {c.max}
                        </span>
                      </div>
                      <div className="bar" role="presentation">
                        <div style={{ width: `${(c.score / c.max) * 100}%`, background: scoreColor(c.score / c.max) }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="actions">
              <button className="btn btn-ghost" onClick={printOwner} disabled={!report}>
                社長向けレポートを印刷・PDF保存
              </button>
              <button className="btn btn-ghost" onClick={copyMemo} disabled={!report}>
                営業メモをコピー
              </button>
              <button className="btn btn-ghost" onClick={reset}>
                別のサイトを診断
              </button>
            </div>

            <BrandSettings brand={brand} onChange={onBrandChange} recipient={recipient} onRecipientChange={setRecipient} />

            {error && (
              <div className="error-box" role="alert" style={{ marginBottom: 14 }}>
                {error}
              </div>
            )}

            <div className="tabs" role="tablist" aria-label="診断結果">
              <TabButton id="owner" current={tab} onSelect={setTab}>社長向けレポート</TabButton>
              <TabButton id="sales" current={tab} onSelect={setTab}>営業メモ</TabButton>
              <TabButton id="checks" current={tab} onSelect={setTab}>
                診断の詳細<span className="tab-count">要改善 {issueCount}</span>
              </TabButton>
            </div>

            <div className="tab-panel" role="tabpanel" id="panel-owner" hidden={tab !== "owner"}>
              {report ? <OwnerReportView report={report} audit={audit} /> : reportLoading && <ReportSkeleton label="社長向けレポート" />}
            </div>
            <div className="tab-panel sales-memo" role="tabpanel" id="panel-sales" hidden={tab !== "sales"}>
              {report ? <SalesMemoView report={report} /> : reportLoading && <ReportSkeleton label="営業メモ" />}
            </div>
            <div className="tab-panel checks-panel" role="tabpanel" id="panel-checks" hidden={tab !== "checks"}>
              <CheckListView audit={audit} />
            </div>
            <PrintFooter brand={brand} />
          </div>
        )}

        {phase !== "done" && phase !== "auditing" && (
          <>
            <section className="features" aria-label="できること">
              <div className="card feature">
                <div className="feature-num">01</div>
                <h3>18項目を自動で診断</h3>
                <p>スマホ対応、表示速度、検索対策、電話・フォームへの導線、更新の新しさまで、点数で見える化します。</p>
              </div>
              <div className="card feature">
                <div className="feature-num">02</div>
                <h3>社長に渡せるレポート</h3>
                <p>「何を損しているか」を専門用語なしで説明します。印刷・PDF保存して、そのまま提案資料に使えます。</p>
              </div>
              <div className="card feature">
                <div className="feature-num">03</div>
                <h3>商談で使える営業メモ</h3>
                <p>切り出しトーク、ヒアリング質問、反論への切り返しまで、あなたの商材に合わせて用意します。</p>
              </div>
            </section>

            {history.length > 0 && (
              <section className="card history" aria-label="最近の診断">
                <h3>最近の診断（この端末だけに保存）</h3>
                <ul>
                  {history.map((h) => (
                    <li key={h.url}>
                      <button
                        onClick={() => {
                          setUrl(h.url);
                          setIndustry(h.industry);
                          setProduct(PRODUCTS.includes(h.product) ? h.product : PRODUCTS[0]);
                          run(h.url, h.industry, h.product);
                        }}
                      >
                        {h.title}
                      </button>
                      <span className="hist-score">{h.score}点</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>※ 診断はトップページなどを自動で読み取った結果で、正確さを保証するものではありません。提案の前に、実際のサイトもご確認ください。</p>
          <p>※ 入力されたURLと診断結果は、レポート作成のためにAIへ送信されます。</p>
        </div>
      </footer>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}

function TabButton({ id, current, onSelect, children }: { id: Tab; current: Tab; onSelect: (t: Tab) => void; children: React.ReactNode }) {
  return (
    <button
      className="tab"
      role="tab"
      id={`tab-${id}`}
      aria-selected={current === id}
      aria-controls={`panel-${id}`}
      onClick={() => onSelect(id)}
      type="button"
    >
      {children}
    </button>
  );
}
