/**
 * مكتبة صور العلامة: نلتقط الصور الحقيقية من موقع المستخدم (وصفحاته الداخلية)
 * ثم نرشّح أنسبها لطلبه فيقترحها الموظف داخل الرد نفسه.
 *
 * مبني على مكتبة cheerio مفتوحة المصدر (MIT) لتحليل HTML.
 */
import * as cheerio from "cheerio";

export type SiteAsset = {
  url: string;
  alt: string;
  pageUrl: string;
  weight: number;
};

const UA =
  "Mozilla/5.0 (compatible; SahlBot/1.0; +https://sahl.app) AppleWebKit/537.36 Chrome/124 Safari/537.36";

/** روابط لا تصلح كصورة محتوى: أيقونات، شعارات صغيرة، بيكسل تتبّع، SVG واجهة. */
const JUNK = /(sprite|icon|favicon|logo|placeholder|avatar|pixel|spacer|blank|loader|badge|flag|1x1)/i;

export function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function getHtml(url: string, timeoutMs = 12000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    return (await res.text()).slice(0, 900_000);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function bestFromSrcset(srcset: string): string | null {
  const parts = srcset
    .split(",")
    .map((p) => p.trim().split(/\s+/))
    .filter((p) => p[0]);
  if (!parts.length) return null;
  // الأعرض غالباً هي نسخة المحتوى الكاملة.
  const scored = parts.map((p) => ({
    url: p[0]!,
    w: Number((p[1] ?? "").replace(/[^\d]/g, "")) || 0,
  }));
  scored.sort((a, b) => b.w - a.w);
  return scored[0]!.url;
}

function collectFromPage(html: string, pageUrl: string): SiteAsset[] {
  const $ = cheerio.load(html);
  const out: SiteAsset[] = [];
  const push = (raw: string | undefined, alt: string, weight: number) => {
    if (!raw) return;
    const abs = (() => {
      try {
        return new URL(raw, pageUrl).toString();
      } catch {
        return null;
      }
    })();
    if (!abs || !/^https?:/i.test(abs)) return;
    if (abs.startsWith("data:")) return;
    if (/\.svg(\?|$)/i.test(abs)) return;
    if (JUNK.test(abs)) return;
    out.push({ url: abs, alt: alt.trim().slice(0, 200), pageUrl, weight });
  };

  // صور المشاركة الاجتماعية: أعلى جودة وأكثرها تمثيلاً للصفحة.
  push($('meta[property="og:image"]').attr("content"), $("title").text(), 60);
  push($('meta[name="twitter:image"]').attr("content"), $("title").text(), 55);
  push($('link[rel="image_src"]').attr("href"), $("title").text(), 40);

  $("img").each((_, el) => {
    const $el = $(el);
    const src =
      $el.attr("src") ??
      $el.attr("data-src") ??
      $el.attr("data-lazy-src") ??
      (($el.attr("srcset") ?? $el.attr("data-srcset")) &&
        bestFromSrcset($el.attr("srcset") ?? $el.attr("data-srcset")!)) ??
      undefined;
    const alt = $el.attr("alt") ?? $el.attr("title") ?? "";
    const w = Number($el.attr("width") ?? 0);
    const h = Number($el.attr("height") ?? 0);
    if ((w && w < 200) || (h && h < 200)) return;
    // صور داخل المقالات/المنتجات أهم من صور الترويسة والتذييل.
    const inMain = $el.closest("article, main, .product, .entry-content, section").length > 0;
    push(src, alt, (alt ? 18 : 8) + (inMain ? 10 : 0));
  });

  // صور منظمة داخل بيانات JSON-LD (منتجات، مقالات).
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).contents().text();
    if (!text || text.length > 200_000) return;
    try {
      const json: unknown = JSON.parse(text);
      const walk = (n: unknown, depth = 0) => {
        if (depth > 6 || !n) return;
        if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
        if (typeof n !== "object") return;
        const o = n as Record<string, unknown>;
        const img = o["image"];
        const name = typeof o["name"] === "string" ? (o["name"] as string) : "";
        if (typeof img === "string") push(img, name, 45);
        if (Array.isArray(img)) img.forEach((x) => typeof x === "string" && push(x, name, 45));
        if (img && typeof img === "object" && typeof (img as { url?: string }).url === "string")
          push((img as { url: string }).url, name, 45);
        Object.values(o).forEach((v) => walk(v, depth + 1));
      };
      walk(json);
    } catch {
      /* تجاهل JSON التالف */
    }
  });

  return out;
}

function internalLinks(html: string, baseUrl: string, limit: number): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const good: string[] = [];
  const preferred = /(product|shop|store|menu|blog|news|service|gallery|work|portfolio|about|منتج|متجر|مدونة|خدمات|أعمال)/i;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#")) return;
    let u: URL;
    try {
      u = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (u.hostname !== base.hostname) return;
    if (/\.(pdf|jpg|png|zip|mp4|webp)$/i.test(u.pathname)) return;
    u.hash = "";
    const key = u.toString();
    if (seen.has(key) || key === baseUrl) return;
    seen.add(key);
    if (preferred.test(u.pathname)) good.unshift(key);
    else good.push(key);
  });
  return good.slice(0, limit);
}

/** يجمع صور الموقع من الصفحة الرئيسية وحتى 5 صفحات داخلية مهمة. */
export async function harvestSiteImages(rawUrl: string, maxPages = 6): Promise<SiteAsset[]> {
  const home = normalizeUrl(rawUrl);
  if (!home) return [];
  const html = await getHtml(home);
  if (!html) return [];

  const assets: SiteAsset[] = collectFromPage(html, home);
  const pages = internalLinks(html, home, maxPages - 1);

  const rest = await Promise.all(
    pages.map(async (p) => {
      const h = await getHtml(p, 9000);
      return h ? collectFromPage(h, p) : [];
    }),
  );
  for (const list of rest) assets.push(...list);

  const byUrl = new Map<string, SiteAsset>();
  for (const a of assets) {
    const prev = byUrl.get(a.url);
    if (!prev || a.weight > prev.weight) byUrl.set(a.url, a);
  }
  return [...byUrl.values()].sort((a, b) => b.weight - a.weight).slice(0, 60);
}

const STOP = new Set([
  "على","في","من","عن","الى","إلى","مع","هذا","هذه","التي","الذي","يا","او","أو","و","ال",
  "اكتب","اعمل","سوّي","سوي","منشور","بوست","صورة","صور","محتوى","لي","لنا","عن",
  "the","a","an","for","with","and","of","to","post","image","write","make","create",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/[ةه]/g, "ه")
    .replace(/[ىي]/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** ترتيب صور الموقع حسب صلتها بنص الطلب (النص البديل + اسم الملف + مسار الصفحة). */
export function rankAssets(query: string, assets: SiteAsset[], limit = 3): SiteAsset[] {
  const q = new Set(tokens(query));
  if (!assets.length) return [];
  const scored = assets.map((a) => {
    const hay = tokens(`${a.alt} ${decodeURIComponent(a.url)} ${decodeURIComponent(a.pageUrl)}`);
    let hits = 0;
    for (const t of hay) if (q.has(t)) hits += 1;
    return { asset: a, score: hits * 25 + a.weight / 10 };
  });
  scored.sort((a, b) => b.score - a.score);
  // لا نقترح صوراً بلا أي صلة إلا إذا لم توجد أي مطابقة إطلاقاً (نرجع الأقوى تمثيلاً).
  const relevant = scored.filter((s) => s.score >= 25);
  return (relevant.length ? relevant : scored).slice(0, limit).map((s) => s.asset);
}
