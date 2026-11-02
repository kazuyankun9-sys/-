import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";

/**
 * 外部サイトを安全に取得するためのユーティリティ。
 * - 社内ネットワークやクラウドのメタデータなど、プライベートなIPには接続しない（SSRF対策）
 * - DNSの解決結果を接続時に検証するため、DNSリバインディングにも強い
 * - タイムアウト・サイズ上限・リダイレクト回数の上限つき
 */

export const USER_AGENT =
  "Mozilla/5.0 (compatible; SiteKarteBot/0.1; +https://github.com/kazuyankun9-sys/-)";

const MAX_REDIRECTS = 5;

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export function isPrivateIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) {
    const lower = ip.toLowerCase();
    // IPv4射影アドレス (::ffff:10.0.0.1)
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateV4(mapped[1]);
    if (lower === "::" || lower === "::1") return true;
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ユニークローカル
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 リンクローカル
    if ((first & 0xff00) === 0xff00) return true; // マルチキャスト
    if (lower.startsWith("64:ff9b:")) return true; // NAT64
    if (lower.startsWith("2001:db8")) return true; // ドキュメント用
    return false;
  }
  return true; // IPとして解釈できないものは拒否
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // リンクローカル・メタデータ
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // マルチキャスト・予約
  return false;
}

/** 接続の直前に呼ばれる名前解決。プライベートIPならエラーにする */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateIp(a.address));
    if (bad || list.length === 0) {
      return callback(
        Object.assign(new Error(`blocked address for ${hostname}`), { code: "EBLOCKED" }),
        "",
        0,
      );
    }
    if (options.all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

export function normalizeUrl(input: string): URL {
  let raw = input.trim();
  if (!raw) throw new FetchError("empty url", "URLを入力してください。");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("invalid url", "URLの形式が正しくありません。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError("bad protocol", "http または https のURLを入力してください。");
  }
  if (url.username || url.password) {
    throw new FetchError("credentials in url", "ID・パスワード付きのURLは診断できません。");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new FetchError("bad port", "標準以外のポート番号のURLは診断できません。");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new FetchError("private ip", "社内ネットワークなど、公開されていないアドレスは診断できません。");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchError("local host", "公開されていないアドレスは診断できません。");
  }
  if (!host.includes(".") && !net.isIP(host)) {
    throw new FetchError("no tld", "URLの形式が正しくありません（例: example.co.jp）。");
  }
  url.hash = "";
  return url;
}

export interface FetchedPage {
  finalUrl: string;
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
  elapsedMs: number;
}

interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
}

function requestOnce(url: URL, opts: Required<FetchOptions>, signal: AbortSignal): Promise<Omit<FetchedPage, "finalUrl" | "elapsedMs">> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: opts.accept,
          "Accept-Language": "ja,en;q=0.5",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, headers: res.headers, body: Buffer.alloc(0), truncated: false });
          return;
        }
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > opts.maxBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxBytes)));
            res.destroy();
            resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated: true });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (!truncated) resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated: false });
        });
        res.on("error", (e) => {
          if (!truncated) reject(e);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

export async function safeFetch(input: URL, options: FetchOptions = {}): Promise<FetchedPage> {
  const opts: Required<FetchOptions> = {
    timeoutMs: options.timeoutMs ?? 12000,
    maxBytes: options.maxBytes ?? 3 * 1024 * 1024,
    accept: options.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  };
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const started = Date.now();
  let url = input;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await requestOnce(url, opts, signal);
    } catch (e) {
      throw toFetchError(e);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      let next: URL;
      try {
        next = normalizeUrl(new URL(res.headers.location, url).toString());
      } catch (e) {
        if (e instanceof FetchError) throw e;
        throw new FetchError("bad redirect", "転送先のURLが正しくありません。");
      }
      url = next;
      continue;
    }
    return { ...res, finalUrl: url.toString(), elapsedMs: Date.now() - started };
  }
  throw new FetchError("too many redirects", "転送（リダイレクト）が多すぎるため取得できませんでした。");
}

function toFetchError(e: unknown): FetchError {
  if (e instanceof FetchError) return e;
  const err = e as NodeJS.ErrnoException & { name?: string };
  const code = err?.code ?? "";
  if (code === "EBLOCKED") return new FetchError(err.message, "公開されていないアドレスのため診断できません。");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return new FetchError(err.message, "サイトが見つかりませんでした。URLのつづりを確認してください。");
  if (err?.name === "TimeoutError" || err?.name === "AbortError" || code === "ABORT_ERR")
    return new FetchError(String(err), "サイトの応答が遅すぎるため、時間切れになりました。");
  if (code === "ECONNREFUSED" || code === "ECONNRESET")
    return new FetchError(err.message, "サイトに接続できませんでした。");
  if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test(err?.message ?? ""))
    return new FetchError(err.message, "SSL証明書に問題があるため、安全に接続できませんでした（それ自体が大きな改善ポイントです）。");
  return new FetchError(String(err?.message ?? e), "サイトを取得できませんでした。");
}

/** Content-Type や meta タグから文字コードを判定してデコード（Shift_JIS / EUC-JP にも対応） */
export function decodeHtml(body: Buffer, contentType: string | undefined): string {
  const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  const head = body.subarray(0, 4096).toString("latin1");
  const fromMeta =
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1];
  const candidates = [fromHeader, fromMeta, "utf-8"].filter(Boolean) as string[];
  for (const enc of candidates) {
    try {
      return new TextDecoder(normalizeEncoding(enc), { fatal: false }).decode(body);
    } catch {
      // 未知の文字コード名 → 次の候補
    }
  }
  return body.toString("utf8");
}

function normalizeEncoding(enc: string): string {
  const e = enc.toLowerCase();
  if (e === "sjis" || e === "x-sjis" || e === "shift-jis" || e === "windows-31j" || e === "ms932") return "shift_jis";
  if (e === "eucjp" || e === "x-euc-jp") return "euc-jp";
  return e;
}
