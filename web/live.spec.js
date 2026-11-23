const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const fs = require("fs");
test("live 3D view reflects actual login and file encryption", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3080");
  await page.getByLabel("Email address").fill(
    fs
      .readFileSync("../.env", "utf8")
      .match(/^DEMO_EMAIL=(.+)$/m)[1]
      .trim(),
  );
  await page.getByLabel("Password", { exact: true }).fill("VellumDemo1!");
  await page.getByLabel("Password", { exact: true }).fill("IncorrectVisual1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".operation-status")).toHaveText(/Rejected/);
  await page
    .locator(".execution-step")
    .filter({ hasText: "Compare password securely" })
    .click();
  await expect(page.locator(".step-inspection")).toContainText("No");
  await page.getByRole("button", { name: "Close live view" }).click();
  await page.getByLabel("Password", { exact: true }).fill("VellumDemo1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const panel = page.getByRole("region", {
    name: "Live backend visualization",
  });
  await expect(panel).toBeVisible();
  await expect(page.locator(".operation-status")).toHaveText(/Completed/, {
    timeout: 15000,
  });
  await expect(page.locator(".scene-canvas canvas")).toBeVisible({
    timeout: 15000,
  });
  await page
    .locator(".execution-step")
    .filter({ hasText: "Compare password securely" })
    .click();
  await expect(page.locator(".step-inspection")).toContainText("bcrypt");
  await page.waitForFunction(
    () =>
      !document.querySelector(".document-table")?.style.transform &&
      !document.querySelector(".live-panel")?.style.transform,
  );
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  fs.writeFileSync(
    "../evidence/live-accessibility.json",
    JSON.stringify(audit.violations, null, 2),
  );
  expect(audit.violations).toEqual([]);
  await page.locator(".live-body").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: "../evidence/live-login-desktop.png",
    fullPage: false,
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "Live trace proof.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "A real file whose cryptographic operations are observed live.",
    ),
  });
  await expect(page.locator(".operation-summary h3")).toHaveText(
    "Encrypt document",
  );
  await expect(page.locator(".operation-status")).toHaveText(/Completed/);
  await page
    .locator(".execution-step")
    .filter({ hasText: "Generate per-file AES key" })
    .click();
  await expect(page.locator(".step-inspection")).toContainText("256");
  await page
    .locator(".execution-step")
    .filter({ hasText: "Encrypt document with AES-GCM" })
    .click();
  await expect(page.locator(".step-inspection")).toContainText(
    "ciphertext preview",
  );
  const traceDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export measured trace/ }).click();
  const download = await traceDownload;
  const trace = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(
    trace.steps.some(
      (s) => s.name === "Wrap the document key" && s.status === "complete",
    ),
  ).toBeTruthy();
  expect(trace.events.at(-1).type).toBe("finished");
  expect(JSON.stringify(trace)).not.toContain("VellumDemo1!");
  await page.locator(".live-body").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: "../evidence/live-encryption-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "../evidence/live-encryption-mobile.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Close live view" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Search documents").fill("Live trace proof");
  page.once("dialog", (d) => d.accept());
  await page.getByTitle("Delete document").click();
  await expect(page.locator(".operation-status")).toHaveText(/Completed/);
  await page.getByRole("button", { name: "Close live view" }).click();
  await page.getByTitle("Sign out").click();
  expect(errors).toEqual([]);
});
