// Explicit opt-in network verification using synthetic fixtures only.
import { chromium } from "@playwright/test";
import { deflate } from "pako";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const results = [];
await mkdir("docs/comparison", { recursive: true });
try {
  for (const fixture of ["flow", "sequence", "state"]) {
    const code = await readFile(
      `tests/fixtures/comparison-${fixture}.mmd`,
      "utf8",
    );
    const hash = Buffer.from(
      deflate(
        JSON.stringify({
          code,
          mermaid: JSON.stringify({
            theme: "default",
            securityLevel: "strict",
            fontFamily: "Arial",
          }),
          autoSync: true,
          updateDiagram: true,
        }),
      ),
    ).toString("base64url");
    const live = await context.newPage();
    await live.goto("https://mermaid.live/edit#pako:" + hash, {
      waitUntil: "domcontentloaded",
    });
    await live
      .getByText("Stay on mermaid.live", { exact: true })
      .click({ timeout: 10000 })
      .catch(() => {});
    const liveSvg = live.locator('svg[id^="graph-"]');
    await liveSvg.locator(".svg-pan-zoom_viewport").waitFor({ timeout: 60000 });
    const local = await context.newPage();
    await local.goto("http://127.0.0.1:1420");
    await local.locator(".svg-position svg").waitFor();
    await local.locator("input[type=file]").setInputFiles({
      name: `comparison-${fixture}.mmd`,
      mimeType: "text/plain",
      buffer: Buffer.from(code),
    });
    await local
      .locator(".document-title strong")
      .filter({ hasText: `comparison-${fixture}.mmd` })
      .waitFor();
    const localSvg = local.locator(".svg-position svg");
    await localSvg.waitFor();
    await local.locator(".stale").waitFor({ state: "detached" });
    const measure = (el) => ({
      viewBox: el.getAttribute("viewBox"),
      bounds: (() => {
        const b = (el.querySelector(".svg-pan-zoom_viewport") ?? el).getBBox();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      })(),
      labels: [...el.querySelectorAll("foreignObject,text")]
        .map((e) => e.textContent.trim())
        .filter(Boolean),
      colors: [
        ...el.querySelectorAll(".node rect, .actor, .statediagram-state rect"),
      ].map((e) => getComputedStyle(e).fill),
    });
    const reference = await liveSvg.evaluate(measure),
      actual = await localSvg.evaluate(measure);
    const version = (await live.locator("body").innerText()).match(
      /v\d+\.\d+\.\d+/,
    )?.[0];
    results.push({
      fixture,
      liveVersion: version,
      appVersion: "12.2.0",
      reference,
      actual,
    });
    await liveSvg.screenshot({ path: `docs/comparison/${fixture}-live.png` });
    await localSvg.screenshot({ path: `docs/comparison/${fixture}-app.png` });
    await live.close();
    await local.close();
  }
  await writeFile(
    "docs/comparison/results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
