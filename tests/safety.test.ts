import { describe, expect, it } from "vitest";
import { isAllowedByRobots } from "@/lib/robots";
import { decodeHtml, FetchError, isPrivateIp, normalizeUrl } from "@/lib/safeFetch";

describe("isPrivateIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])(
    "%s は拒否",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "203.104.209.1", "2606:4700::1111", "172.32.0.1"])("%s は許可", (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe("normalizeUrl", () => {
  it("スキームが無ければ https を補う", () => {
    expect(normalizeUrl("example.co.jp").toString()).toBe("https://example.co.jp/");
  });
  it.each(["ftp://example.com", "http://localhost/", "http://192.168.0.1/", "http://[::1]/", "https://user:pw@example.com", "https://example.com:8080/", "intranet", "file:///etc/passwd"])(
    "%s は拒否",
    (u) => expect(() => normalizeUrl(u)).toThrow(FetchError),
  );
});

describe("isAllowedByRobots", () => {
  it("全体禁止なら拒否", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow: /", "/")).toBe(false);
  });
  it("一部禁止ならトップは許可", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow: /admin/", "/")).toBe(true);
  });
  it("空のDisallowは全許可", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow:", "/")).toBe(true);
  });
  it("このツール専用の指定を優先する", () => {
    const txt = "User-agent: *\nDisallow:\n\nUser-agent: SiteKarteBot\nDisallow: /";
    expect(isAllowedByRobots(txt, "/")).toBe(false);
  });
  it("より長いAllowが優先される", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow: /\nAllow: /$", "/")).toBe(true);
  });
});

describe("decodeHtml", () => {
  it("Shift_JIS のページを正しく読める", () => {
    // 「会社概要」を Shift_JIS で表したバイト列
    const sjis = Buffer.from([0x89, 0xef, 0x8e, 0xd0, 0x8a, 0x54, 0x97, 0x76]);
    const html = Buffer.concat([Buffer.from('<meta charset="Shift_JIS">'), sjis]);
    expect(decodeHtml(html, "text/html")).toContain("会社概要");
  });
});
