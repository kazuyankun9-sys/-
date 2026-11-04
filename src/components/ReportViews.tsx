import { CATEGORY_META, type AuditResult, type CategoryId, type ReportResult } from "@/lib/types";

const PRIORITY_LABEL = { high: "優先度：高", medium: "優先度：中", low: "優先度：低" } as const;

export function ReportSkeleton({ label }: { label: string }) {
  return (
    <div className="card section" aria-busy="true">
      <h3>{label}</h3>
      <p className="form-note" style={{ marginTop: 0 }}>AIがレポートを作成しています（10〜40秒ほど）…</p>
      <div className="skeleton">
        <div style={{ width: "70%" }} />
        <div />
        <div style={{ width: "85%" }} />
        <div style={{ width: "60%" }} />
      </div>
    </div>
  );
}

function SourceNote({ report }: { report: ReportResult }) {
  if (report.source === "ai") return null;
  return <div className="note-banner">{report.note ?? "簡易レポートを表示しています。"}</div>;
}

export function OwnerReportView({ report, audit }: { report: ReportResult; audit: AuditResult }) {
  const o = report.ownerReport;
  return (
    <div>
      <SourceNote report={report} />
      <div className="card section">
        <h3>
          総評 {report.source === "ai" && <span className="ai-chip">AI作成</span>}
        </h3>
        <p className="headline">{o.headline}</p>
        <p className="lead">{o.summary}</p>
      </div>

      {o.lossPoints.length > 0 && (
        <div className="card section">
          <h3>このままだと損している可能性があること</h3>
          <div className="loss-grid">
            {o.lossPoints.map((l, i) => (
              <div className="loss-item" key={i}>
                <strong>{l.title}</strong>
                <p>{l.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {o.improvements.length > 0 && (
        <div className="card section">
          <h3>改善のご提案</h3>
          {o.improvements.map((imp, i) => (
            <div className="improve" key={i}>
              <div className="improve-head">
                <strong>
                  {i + 1}. {imp.title}
                </strong>
                <span className={`tag tag-${imp.priority}`}>{PRIORITY_LABEL[imp.priority]}</span>
                <span className="tag tag-neutral">{imp.effort}</span>
              </div>
              <p>
                <span className="label">なぜ</span>
                {imp.why}
              </p>
              <p>
                <span className="label">どうする</span>
                {imp.how}
              </p>
            </div>
          ))}
        </div>
      )}

      {o.strengths.length > 0 && (
        <div className="card section">
          <h3>良い点</h3>
          <ul className="plain-list">
            {o.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function SalesMemoView({ report }: { report: ReportResult }) {
  const m = report.salesMemo;
  return (
    <div className="sales-memo">
      <SourceNote report={report} />
      <div className="card section">
        <h3>
          切り出しトーク <span className="internal-badge">社内用・お客様に見せない</span>
        </h3>
        <p className="opening">{m.opening}</p>
      </div>

      <div className="card section">
        <h3>ヒアリングで聞くこと</h3>
        <div className="qa">
          {m.hearingQuestions.map((q, i) => (
            <div className="qa-item" key={i}>
              <div className="q">Q{i + 1}. {q.question}</div>
              <div className="a">ねらい：{q.intent}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card section">
        <h3>提案の切り口</h3>
        <div className="qa">
          {m.proposalAngles.map((p, i) => (
            <div className="qa-item" key={i}>
              <div className="q">{p.title}</div>
              <div className="a" style={{ color: "var(--text)" }}>{p.pitch}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card section">
        <h3>想定される反論と切り返し</h3>
        <div className="qa">
          {m.objections.map((o, i) => (
            <div className="qa-item" key={i}>
              <div className="q">「{o.objection}」</div>
              <div className="a" style={{ color: "var(--text)" }}>→ {o.response}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card section">
        <h3>次の一手</h3>
        <p className="lead">{m.nextAction}</p>
      </div>
    </div>
  );
}

const STATUS_ICON = { pass: "✓", warn: "!", fail: "×" } as const;
const STATUS_LABEL = { pass: "良好", warn: "要改善", fail: "問題あり" } as const;

export function CheckListView({ audit }: { audit: AuditResult }) {
  const order = Object.keys(CATEGORY_META) as CategoryId[];
  return (
    <div>
      <div className="print-only" style={{ margin: "18px 0 8px", fontWeight: 700, fontSize: "14pt" }}>
        診断の詳細
      </div>
      {order.map((cat) => {
        const items = audit.checks.filter((c) => c.category === cat);
        const cs = audit.categories.find((c) => c.id === cat);
        return (
          <div className="card section" key={cat}>
            <h3 className="cat-title">
              <span>{CATEGORY_META[cat].label}</span>
              <span className="check-score">
                {cs?.score} / {cs?.max}点
              </span>
            </h3>
            {items.map((c) => (
              <div className="check" key={c.id}>
                <div className={`status-icon st-${c.status}`} aria-label={STATUS_LABEL[c.status]} title={STATUS_LABEL[c.status]}>
                  {STATUS_ICON[c.status]}
                </div>
                <div>
                  <div className="check-title">{c.label}</div>
                  <div className="check-body">
                    <p>{c.finding}</p>
                    {c.status !== "pass" && <p className="check-impact">{c.impact}</p>}
                    {c.status !== "pass" && (
                      <p>
                        <strong>改善策：</strong>
                        {c.fix}
                      </p>
                    )}
                  </div>
                </div>
                <div className="check-score">
                  {c.score} / {c.maxScore}点
                </div>
              </div>
            ))}
          </div>
        );
      })}
      <p className="form-note no-print">
        ※ この診断は、トップページと会社概要・お問い合わせのページを自動で読み取った結果です。JavaScriptで後から表示される内容や、そのほかの下層ページの内容は反映されない場合があります。
      </p>
    </div>
  );
}

export function salesMemoToText(audit: AuditResult, report: ReportResult): string {
  const m = report.salesMemo;
  const lines = [
    `【営業メモ】${audit.facts.title || audit.finalUrl}`,
    `URL: ${audit.finalUrl}`,
    `診断スコア: ${audit.totalScore}/100（ランク${audit.grade}）`,
    "",
    "■ 切り出しトーク",
    m.opening,
    "",
    "■ ヒアリング",
    ...m.hearingQuestions.map((q, i) => `Q${i + 1}. ${q.question}\n   （ねらい：${q.intent}）`),
    "",
    "■ 提案の切り口",
    ...m.proposalAngles.map((p) => `・${p.title}：${p.pitch}`),
    "",
    "■ 反論と切り返し",
    ...m.objections.map((o) => `・「${o.objection}」→ ${o.response}`),
    "",
    "■ 次の一手",
    m.nextAction,
  ];
  return lines.join("\n");
}
