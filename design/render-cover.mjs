// Render design/cover.html to a crisp 2560x1440 PNG (1280x720 @2x).
import { chromium } from "playwright-core";

const CHROME =
  process.env.HOME +
  "/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const ROOT = "/Users/lynn/Desktop/spark-hackathon/tab-monad";

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
});
await page.goto("file://" + ROOT + "/design/cover.html", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: ROOT + "/design/cover.png", clip: { x: 0, y: 0, width: 1280, height: 720 } });
await browser.close();
console.log("design/cover.png written (2560x1440)");
