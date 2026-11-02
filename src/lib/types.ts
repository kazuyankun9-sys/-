export type CategoryId = "mobile" | "seo" | "trust" | "conversion" | "freshness";

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  id: string;
  category: CategoryId;
  label: string;
  status: CheckStatus;
  score: number;
  maxScore: number;
  /** 何が見つかったか（事実） */
  finding: string;
  /** 経営者にとっての意味（専門用語なし） */
  impact: string;
  /** 改善の方向性 */
  fix: string;
}

export interface CategoryScore {
  id: CategoryId;
  label: string;
  score: number;
  max: number;
}

export interface PageSpeedResult {
  ok: true;
  performance: number; // 0-100
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
}

export interface PageSpeedError {
  ok: false;
  reason: string;
}

/** AIに渡す、サイトから抽出した事実 */
export interface SiteFacts {
  title: string;
  description: string;
  h1: string[];
  headings: string[];
  navLinks: string[];
  phoneNumbers: string[];
  latestDate: string | null;
  copyrightYear: number | null;
  snsFound: string[];
  textExcerpt: string;
}

export interface AuditResult {
  inputUrl: string;
  finalUrl: string;
  fetchedAt: string;
  responseMs: number;
  htmlBytes: number;
  totalScore: number;
  grade: "S" | "A" | "B" | "C" | "D";
  categories: CategoryScore[];
  checks: Check[];
  pagespeed: PageSpeedResult | PageSpeedError;
  facts: SiteFacts;
}

export interface SalesContext {
  industry?: string;
  product?: string;
}

export interface ReportResult {
  source: "ai" | "template";
  /** template になった理由など */
  note?: string;
  ownerReport: {
    headline: string;
    summary: string;
    strengths: string[];
    lossPoints: { title: string; detail: string }[];
    improvements: {
      title: string;
      why: string;
      how: string;
      priority: "high" | "medium" | "low";
      effort: "すぐできる" | "数日" | "制作が必要";
    }[];
  };
  salesMemo: {
    opening: string;
    hearingQuestions: { question: string; intent: string }[];
    proposalAngles: { title: string; pitch: string }[];
    objections: { objection: string; response: string }[];
    nextAction: string;
  };
}

export const CATEGORY_META: Record<CategoryId, { label: string; max: number }> = {
  mobile: { label: "スマホ対応・表示速度", max: 25 },
  seo: { label: "検索での見つかりやすさ", max: 20 },
  trust: { label: "信頼・安心感", max: 20 },
  conversion: { label: "問い合わせへの導線", max: 25 },
  freshness: { label: "情報の新しさ・発信", max: 10 },
};
