"use client";

import { useRef, useState } from "react";
import type { AuditResult } from "@/lib/types";

/** PDFレポートに入れる「提案者（自社）」の情報。この端末のブラウザにだけ保存する */
export interface Brand {
  company: string;
  person: string;
  phone: string;
  email: string;
  /** ロゴ画像（縮小してdata URLで保存） */
  logo: string;
}

export const EMPTY_BRAND: Brand = { company: "", person: "", phone: "", email: "", logo: "" };
const BRAND_KEY = "sitekarte:brand";

export function loadBrand(): Brand {
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    return raw ? { ...EMPTY_BRAND, ...(JSON.parse(raw) as Partial<Brand>) } : EMPTY_BRAND;
  } catch {
    return EMPTY_BRAND;
  }
}

export function saveBrand(b: Brand): boolean {
  try {
    localStorage.setItem(BRAND_KEY, JSON.stringify(b));
    return true;
  } catch {
    return false;
  }
}

/** ロゴ画像を、横幅最大480pxのPNGに縮小する（保存容量を抑えるため） */
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode"));
      img.onload = () => {
        const scale = Math.min(1, 480 / img.width, 160 / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function BrandSettings({
  brand,
  onChange,
  recipient,
  onRecipientChange,
}: {
  brand: Brand;
  onChange: (b: Brand) => void;
  recipient: string;
  onRecipientChange: (v: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState("");
  const set = (k: keyof Brand) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...brand, [k]: e.target.value });

  const onLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.type)) {
      setLogoError("PNG・JPEG・SVGなどの画像を選んでください。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setLogoError("5MB以下の画像を選んでください。");
      return;
    }
    try {
      onChange({ ...brand, logo: await resizeImage(file) });
      setLogoError("");
    } catch {
      setLogoError("画像を読み込めませんでした。別の画像でお試しください。");
    }
  };

  return (
    <details className="card brand-settings no-print">
      <summary>
        PDFに入れる宛名・自社ロゴ・連絡先
        {brand.company && <span className="brand-chip">{brand.company}</span>}
      </summary>
      <div className="brand-grid">
        <div className="field brand-wide">
          <label htmlFor="recipient">宛名（相手の会社名）</label>
          <input id="recipient" className="input" maxLength={60} placeholder="例：株式会社〇〇" value={recipient} onChange={(e) => onRecipientChange(e.target.value)} />
          <span className="form-note">「〇〇 御中」として表紙に入ります。空欄なら入りません。</span>
        </div>
        <div className="field">
          <label htmlFor="b-company">あなたの会社名</label>
          <input id="b-company" className="input" maxLength={60} value={brand.company} onChange={set("company")} placeholder="例：〇〇株式会社" />
        </div>
        <div className="field">
          <label htmlFor="b-person">担当者名</label>
          <input id="b-person" className="input" maxLength={40} value={brand.person} onChange={set("person")} placeholder="例：山田 太郎" />
        </div>
        <div className="field">
          <label htmlFor="b-phone">電話番号</label>
          <input id="b-phone" className="input" maxLength={30} inputMode="tel" value={brand.phone} onChange={set("phone")} placeholder="例：03-1234-5678" />
        </div>
        <div className="field">
          <label htmlFor="b-email">メールアドレス</label>
          <input id="b-email" className="input" maxLength={80} inputMode="email" value={brand.email} onChange={set("email")} placeholder="例：yamada@example.co.jp" />
        </div>
        <div className="field brand-wide">
          <label>ロゴ画像</label>
          <div className="logo-row">
            {brand.logo ? <img src={brand.logo} alt="自社ロゴ" className="logo-preview" /> : <span className="logo-empty">未設定</span>}
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              画像を選ぶ
            </button>
            {brand.logo && (
              <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...brand, logo: "" })}>
                削除
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogo} />
          </div>
          {logoError && <span className="form-note" style={{ color: "var(--fail)" }}>{logoError}</span>}
        </div>
      </div>
      <p className="form-note">自社の情報は、この端末のブラウザにだけ保存されます（サーバーには送りません）。</p>
    </details>
  );
}

const PAGE_LABEL = { top: "トップ", company: "会社概要", contact: "お問い合わせ" } as const;

/** 印刷・PDFの表紙部分 */
export function PrintHeader({ audit, brand, recipient }: { audit: AuditResult; brand: Brand; recipient: string }) {
  const date = new Date(audit.fetchedAt).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  const pages = (audit.pagesChecked ?? []).map((p) => PAGE_LABEL[p.kind]).join("・") || "トップ";
  return (
    <div className="print-only print-header">
      <div className="print-brand">
        {brand.logo ? <img src={brand.logo} alt={brand.company || "ロゴ"} /> : <span />}
        {brand.company && <span className="print-brand-name">{brand.company}</span>}
      </div>
      {recipient.trim() && <div className="print-recipient">{recipient.trim()} 御中</div>}
      <h1>ホームページ診断レポート</h1>
      <div className="print-meta">
        <div>対象サイト：{audit.finalUrl}</div>
        <div>
          診断日：{date} ／ 確認したページ：{pages}
        </div>
      </div>
    </div>
  );
}

/** 印刷・PDFの最後に入れる、提案者の連絡先 */
export function PrintFooter({ brand }: { brand: Brand }) {
  const has = brand.company || brand.person || brand.phone || brand.email;
  return (
    <div className="print-only print-footer">
      {has && (
        <div className="print-contact">
          <div className="print-contact-title">このレポートについてのご相談・お問い合わせ</div>
          <div className="print-contact-body">
            {brand.logo && <img src={brand.logo} alt="" />}
            <div>
              {brand.company && <div className="print-contact-company">{brand.company}</div>}
              {brand.person && <div>担当：{brand.person}</div>}
              {(brand.phone || brand.email) && (
                <div>
                  {brand.phone && <>TEL：{brand.phone}　</>}
                  {brand.email && <>メール：{brand.email}</>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <p className="print-disclaimer">
        ※ この診断は、ホームページを自動で読み取った結果にもとづくもので、正確さを保証するものではありません。JavaScriptで後から表示される内容などは反映されない場合があります。
      </p>
    </div>
  );
}
