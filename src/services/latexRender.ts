import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { logger } from "./loggingService.js";

// Minimal browser-global shapes for the page.evaluate closure
// (the project lib is ES2022 without DOM types).
declare const document: {
  getElementById(id: string): { innerHTML: string } | null;
};
declare const window: unknown;

const WRAP_WIDTH_PX = 1000;
const RENDER_TIMEOUT_MS = 30000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Markdown-ish text segment -> HTML paragraphs (bold/italic, line breaks). */
function textToHtml(t: string): string {
  const paras = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras
    .map((p) => {
      let h = escapeHtml(p).replace(/\n/g, "<br>");
      h = h.replace(/\*\*([^*<>]+)\*\*/g, "<strong>$1</strong>");
      h = h.replace(/(^|[\s(])\*([^*\n<>]+)\*/g, "$1<em>$2</em>");
      return `<p>${h}</p>`;
    })
    .join("");
}

export interface CardOpts {
  /** Slim header line, e.g. "Daily Problem — Sep 10". Omit for none. */
  title?: string;
  /** Tiny footer line, e.g. source + license. Omit for none. */
  footer?: string;
}

/**
 * Pure: wrap rendered body HTML in the full card (header + content + footer).
 * Everything lives inside the single PNG — the Discord message itself
 * carries no text at all.
 */
export function buildCardHtml(bodyHtml: string, opts: CardOpts = {}): string {
  const head = opts.title ? `<div class="card-head"><span class="rule"></span><span>${escapeHtml(opts.title)}</span></div>` : "";
  const foot = opts.footer ? `<div class="card-foot">${escapeHtml(opts.footer)}</div>` : "";
  return `${head}<div class="card-body">${bodyHtml}</div>${foot}`;
}

/**
 * Pure: full problem/solution markdown -> HTML with `\\(...\\)` inline and
 * `\\[...\\]` display math for MathJax. Prose is HTML-escaped; math is kept
 * verbatim so the whole message renders exactly like TeXit does.
 */
export function messageToHtml(md: string): string {
  const parts: string[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    parts.push(textToHtml(md.slice(last, m.index)));
    const tex = escapeHtml((m[1] ?? m[2] ?? "").trim());
    if (tex) parts.push(m[1] !== undefined ? `\\[${tex}\\]` : `\\(${tex}\\)`);
    last = m.index + m[0].length;
  }
  parts.push(textToHtml(md.slice(last)));
  return parts.join("");
}

// --- Persistent headless page (one browser for the process lifetime) ---

const cjsRequire = createRequire(__filename);

let browserPromise: Promise<{ browser: Browser; page: Page }> | null = null;
let bundle: string | null = null;

function getBundle(): string {
  if (!bundle) {
    const path = cjsRequire.resolve("mathjax-full/es5/tex-svg.js");
    bundle = readFileSync(path, "utf-8");
  }
  return bundle;
}

async function getPage(): Promise<Page> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const browser = await puppeteer.launch({
        headless: true,
        // Required on servers/containers (and harmless on desktop):
        // no setuid sandbox + no /dev/shm dependence.
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1100, height: 600, deviceScaleFactor: 2 });
      await page.setContent(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><style>` +
          `html,body{margin:0;padding:0;background:#000;}` +
          `#wrap{background:#000;color:#fff;font:34px/1.6 "Segoe UI",Arial,sans-serif;` +
          `padding:40px 44px;width:${WRAP_WIDTH_PX}px;box-sizing:border-box;overflow-wrap:break-word;}` +
          `.card-head{display:flex;align-items:center;gap:16px;margin:0 0 26px;` +
          `font-size:18px;letter-spacing:5px;text-transform:uppercase;color:#c9a227;}` +
          `.card-head .rule{display:inline-block;width:64px;height:3px;background:#c9a227;}` +
          `.card-body p{margin:0 0 20px;}.card-body p:last-child{margin-bottom:0;}` +
          `mjx-container[jax="SVG"]{font-size:118%;}` +
          `mjx-container[jax="SVG"][display="true"]{margin:24px 0;}` +
          `.card-foot{margin:28px 0 0;font-size:16px;letter-spacing:1px;color:#8e9297;}` +
          `</style></head><body><div id="wrap"></div>` +
          `<script>window.MathJax={tex:{inlineMath:[['\\\\(','\\\\)']],displayMath:[['\\\\[','\\\\]']],` +
          `processEscapes:true},svg:{fontCache:'local'},startup:{typeset:false}};<\/script>` +
          `<script>${getBundle()}<\/script></body></html>`,
        { waitUntil: "load", timeout: RENDER_TIMEOUT_MS },
      );
      return { browser, page };
    })();
  }
  return (await browserPromise).page;
}

// Serialize renders: one page, one typeset at a time.
let tail: Promise<unknown> = Promise.resolve();

/**
 * Render a whole markdown message to a single black-background PNG
 * (white text + math), TeXit-style, with slim in-image header/footer.
 * Throws on timeout/browser failure — callers must fall back to plain text.
 */
export async function renderMessageImage(md: string, opts: CardOpts = {}): Promise<Buffer> {
  const html = buildCardHtml(messageToHtml(md), opts);
  const run = tail.then(async () => {
    const page = await getPage();
    await page.evaluate((bodyHtml: string) => {
      const el = document.getElementById("wrap");
      if (!el) throw new Error("no wrap");
      el.innerHTML = bodyHtml;
      const mj = (window as { MathJax: { typesetPromise: (els: unknown[]) => Promise<void> } }).MathJax;
      return mj.typesetPromise([el]);
    }, html);
    const el = await page.$("#wrap");
    if (!el) throw new Error("wrap element missing");
    const png = await el.screenshot({ type: "png" });
    return Buffer.from(png);
  });
  tail = run.catch(() => undefined);
  return run as Promise<Buffer>;
}

/** Test/shutdown helper: close the shared browser. */
export async function closeRenderer(): Promise<void> {
  if (!browserPromise) return;
  try {
    const { browser } = await browserPromise;
    await browser.close();
  } catch (err) {
    logger.warn("LATEX", `Renderer close failed: ${String(err)}`);
  } finally {
    browserPromise = null;
  }
}
