/**
 * middleware.js: Vercel Routing Middleware (runs on Vercel's edge, NOT in the browser)
 *
 * This file is not loaded by index.html and is not imported by script.js.
 * Vercel detects a root-level `middleware.js` automatically and runs it
 * before serving the matched routes (see `config.matcher` below). It doesn't
 * need a framework, and it won't work if you open the site locally as plain files.
 *
 * What it does: for requests to "/", it picks the user's language (saved `lang`
 * cookie first, then the Accept-Language header, then the default), fetches
 * index.html and lang/<code>.json, and fills in the <html lang dir>, <title> and
 * description/Open Graph meta tags before the HTML is sent. That way crawlers
 * and link previews, which don't run JavaScript, see localized content.
 *
 * Supported languages come from /languages.json. The client-side script still
 * handles the rest of the UI and the language switcher.
 */

export const config = {
  matcher: ["/"],
};

const DEFAULT = "en";
const FALLBACK_LANGUAGES = [{ code: "en", name: "English", dir: "ltr" }];
const FALLBACK_TITLE = "Diabetes Risk Assessment Quiz";
const FALLBACK_DESCRIPTION =
  "Take this quick, ADA-standard-based diabetes risk assessment quiz to evaluate your risk level and find out if you need a medical follow-up.";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getLanguages(origin) {
  try {
    const res = await fetch(`${origin}/languages.json`);
    if (!res.ok) return FALLBACK_LANGUAGES;
    return await res.json();
  } catch {
    return FALLBACK_LANGUAGES;
  }
}

function pickLocale(request, supportedCodes) {
  const cookie = request.headers.get("cookie") || "";
  const saved = cookie.match(/(?:^|;\s*)lang=([a-z]{2})/)?.[1];
  if (saved && supportedCodes.includes(saved)) return saved;

  const header = request.headers.get("accept-language") || "";
  for (const part of header.split(",")) {
    const code = part.trim().split(";")[0].slice(0, 2).toLowerCase();
    if (supportedCodes.includes(code)) return code;
  }
  return DEFAULT;
}

export default async function middleware(request) {
  const origin = new URL(request.url).origin;

  const languages = await getLanguages(origin);
  const supportedCodes = languages.map((l) => l.code);

  const locale = pickLocale(request, supportedCodes);
  const currentLangMeta =
    languages.find((l) => l.code === locale) || languages[0];
  const dir = currentLangMeta.dir || "ltr";

  const [htmlRes, langRes] = await Promise.all([
    fetch(`${origin}/index.html`),
    fetch(`${origin}/lang/${locale}.json`).catch(() => null),
  ]);

  if (!htmlRes.ok) return htmlRes;

  let strings = {};
  try {
    if (langRes?.ok) strings = await langRes.json();
  } catch {}

  const title = escapeHtml(
    strings.metaTitle || strings.appName || FALLBACK_TITLE,
  );
  const description = escapeHtml(
    strings.metaDescription || strings.appDescription || FALLBACK_DESCRIPTION,
  );

  const html = (await htmlRes.text())
    .replace('<html lang="en">', () => `<html lang="${locale}" dir="${dir}">`)
    .replace(/<title>.*?<\/title>/, () => `<title>${title}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/,
      () =>
        `<meta name="description" id="meta-desc" content="${description}" />`,
    )
    .replace(
      "</head>",
      () => `<meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:locale" content="${locale}" />
</head>`,
    );

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      vary: "Accept-Language, Cookie",
    },
  });
}
