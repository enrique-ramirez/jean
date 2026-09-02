import { chromium } from "@playwright/test";
const br = await chromium.launch();
const c = await br.newContext({ viewport: { width: 440, height: 1340 } });
const p = await c.newPage();
await p.goto("http://localhost:5211/#/playing", { waitUntil: "networkidle" });
await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await p.waitForTimeout(2600);
for (const t of ["Playing", "Artist"]) {
  const b = p.getByRole("button", { name: t, exact: true });
  if (await b.count()) { await b.click(); await p.waitForTimeout(1100);
    await p.screenshot({ path: `/tmp/c-${t.toLowerCase()}.png` }); }
}
await br.close();
