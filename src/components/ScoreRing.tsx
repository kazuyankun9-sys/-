import type { AuditResult } from "@/lib/types";

export function scoreColor(ratio: number): string {
  if (ratio >= 0.75) return "var(--pass)";
  if (ratio >= 0.5) return "var(--warn)";
  return "var(--fail)";
}

const GRADE_LABEL: Record<AuditResult["grade"], string> = {
  S: "ランクS・とても良い",
  A: "ランクA・良い",
  B: "ランクB・伸びしろあり",
  C: "ランクC・要改善",
  D: "ランクD・早めの改善を",
};

export function ScoreRing({ score, grade }: { score: number; grade: AuditResult["grade"] }) {
  const r = 68;
  const c = 2 * Math.PI * r;
  const color = scoreColor(score / 100);
  return (
    <div className="score-ring" role="img" aria-label={`総合スコア 100点中${score}点、${GRADE_LABEL[grade]}`}>
      <svg width="156" height="156" viewBox="0 0 156 156" aria-hidden="true">
        <circle className="ring-bg" cx="78" cy="78" r={r} fill="none" strokeWidth="12" />
        <circle
          className="ring-fg"
          cx="78"
          cy="78"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>
      <div className="score-center">
        <div>
          <div className="score-num" style={{ color }}>{score}</div>
          <div className="score-max">/ 100点</div>
        </div>
      </div>
      <div className="grade-pill">{GRADE_LABEL[grade]}</div>
    </div>
  );
}
