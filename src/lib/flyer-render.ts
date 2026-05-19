import type { Browser } from "puppeteer-core";

let browserPromise: Promise<Browser> | null = null;

const DEFAULT_CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--font-render-hinting=none",
];

async function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;

  browserPromise = (async () => {
    const puppeteer = await import("puppeteer-core");
    const { existsSync } = await import("fs");
    const { join } = await import("path");

    let executablePath: string | undefined;
    let args = DEFAULT_CHROMIUM_ARGS;

    const envPaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_PATH,
      process.env.GOOGLE_CHROME_BIN,
    ].filter(Boolean) as string[];

    for (const envPath of envPaths) {
      if (existsSync(envPath)) executablePath = envPath;
      if (executablePath) break;
    }

    if (!executablePath) {
      const candidates = [
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ];
      executablePath = candidates.find((p) => existsSync(p));
    }

    if (!executablePath) {
      const names = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"];
      for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
        executablePath = names.map((name) => join(dir, name)).find((p) => existsSync(p));
        if (executablePath) break;
      }
    }

    if (!executablePath) {
      try {
        const chromium = await import("@sparticuz/chromium");
        executablePath = await chromium.default.executablePath();
        args = [...chromium.default.args, ...DEFAULT_CHROMIUM_ARGS];
      } catch {
        // @sparticuz/chromium not available or broken
      }
    }

    if (!executablePath) {
      throw new Error(
        "No Chromium binary found. Set PUPPETEER_EXECUTABLE_PATH, install system chromium, or add @sparticuz/chromium."
      );
    }

    return puppeteer.default.launch({
      executablePath,
      headless: true,
      args: [...new Set(args)],
    });
  })().catch((e) => {
    browserPromise = null;
    throw new Error(
      `Chromium launch failed. Ensure the deployment image includes Chromium runtime libraries such as libnspr4 and libnss3, or set PUPPETEER_EXECUTABLE_PATH to a working system Chrome/Chromium binary. ${
        e instanceof Error ? e.message : "Unknown launch error."
      }`
    );
  });

  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    // already closed
  }
  browserPromise = null;
}

const LETTER_WIDTH = 816;
const LETTER_HEIGHT = 1056;

export async function renderFlyerPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: LETTER_WIDTH, height: LETTER_HEIGHT });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
    const pdf = await page.pdf({
      width: `${LETTER_WIDTH}px`,
      height: `${LETTER_HEIGHT}px`,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

const SOCIAL_WIDTH = 1080;
const SOCIAL_HEIGHT = 1350;

export async function renderFlyerPng(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: SOCIAL_WIDTH, height: SOCIAL_HEIGHT, deviceScaleFactor: 2 });

    const scaledHtml = html
      .replace(/width:816px/g, `width:${SOCIAL_WIDTH}px`)
      .replace(/height:1056px/g, `height:${SOCIAL_HEIGHT}px`);

    await page.setContent(scaledHtml, { waitUntil: "networkidle0", timeout: 30_000 });
    const screenshot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: SOCIAL_WIDTH, height: SOCIAL_HEIGHT },
    });
    return Buffer.from(screenshot);
  } finally {
    await page.close();
  }
}
