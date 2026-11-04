import { safeFetch } from "./safeFetch";

/**
 * robots.txt を読み、このツール（または全ボット向け）が対象パスへのアクセスを
 * 禁止されていないかを確認する。取得できない場合は「許可」とみなす（一般的な扱い）。
 */
export function isAllowedByRobots(robotsTxt: string, path: string, agent = "sitekartebot"): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue;
      if (key === "disallow" && value === "") continue; // 空のDisallowは全許可
      current.rules.push({ allow: key === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const applicable = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = applicable.flatMap((g) => g.rules);

  // 最も長く一致したルールを採用（Googleと同じ解釈）
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    if (matches(r.path, path)) {
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(
    "^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""),
  );
  return regex.test(path);
}

/**
 * robots.txt を1回だけ読み、同じサイト内のパスを何度でも確認できる関数を返す。
 * 取得できない場合は「許可」とみなす（一般的な扱い）。
 */
export async function loadRobots(url: URL): Promise<(target: URL) => boolean> {
  let txt = "";
  try {
    const robotsUrl = new URL("/robots.txt", url);
    const res = await safeFetch(robotsUrl, { timeoutMs: 5000, maxBytes: 256 * 1024, accept: "text/plain,*/*" });
    if (res.status === 200) txt = res.body.toString("utf8");
  } catch {
    // 取得できなければ許可とみなす
  }
  return (target: URL) => (txt ? isAllowedByRobots(txt, target.pathname + target.search) : true);
}

export async function checkRobots(url: URL): Promise<boolean> {
  return (await loadRobots(url))(url);
}
