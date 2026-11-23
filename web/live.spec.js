const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const fs = require("fs");
test("actual verifier comparison and byte-by-byte AES-GCM transformation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const status = (value) =>
    expect
      .poll(() => page.locator(".operation-status").innerText())
      .toMatch(value);
  await page.goto("http://localhost:3080");
  await page.getByLabel("Email address").fill(
    fs
      .readFileSync("../.env", "utf8")
      .match(/^DEMO_EMAIL=(.+)$/m)[1]
      .trim(),
  );
  await page.getByLabel("Password", { exact: true }).fill("IncorrectVisual1!");
  // Interrupt one real event stream: the capability-protected replay must
  // recover its real comparison and terminal result without repeating login.
  await page.route("**/api/observe/*/events", (route) => route.abort(), {
    times: 1,
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await status(/Rejected/);
  await expect(page.locator(".comparison-verdict")).toContainText("NO MATCH");
  await page.getByRole("button", { name: "Close live view" }).click();
  await page.getByLabel("Password", { exact: true }).fill("VellumDemo1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await status(/Completed/);
  await expect(page.locator(".comparison-verdict")).toContainText("MATCH");
  const panels = page.locator(".comparison-board .fingerprint-tiles");
  expect(await panels.nth(0).innerText()).toBe(await panels.nth(1).innerText());
  await page.waitForFunction(
    () => !document.querySelector(".live-panel")?.style.transform,
  );
  await page.screenshot({
    path: "../evidence/real-login-transformation.png",
    fullPage: false,
  });
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  fs.writeFileSync(
    "../evidence/transformation-accessibility.json",
    JSON.stringify(audit.violations, null, 2),
  );
  expect(audit.violations).toEqual([]);
  await page.getByRole("button", { name: "Close live view" }).click();
  const raw = Buffer.from(
    "Actual encryption bytes 0123456789 — verified against the stored file.",
  );
  const filename = `Actual transformation ${Date.now()}.txt`;
  await page.locator("input[type=file]").setInputFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: raw,
  });
  await status(/Completed/);
  await expect(page.locator(".mechanism-workbench")).toContainText(
    "Watch the bytes change.",
  );
  await expect(
    page.locator(".byte-panel").nth(0).locator(".byte-grid b").first(),
  ).toHaveText("41");
  await expect(page.locator(".mechanism-result").first()).toContainText(
    "independently calculated",
  );
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll(".byte-grid > *")].some(
        (el) => el.style.transform,
      ),
  );
  const byteAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  fs.writeFileSync(
    "../evidence/byte-transformation-accessibility.json",
    JSON.stringify(byteAudit.violations, null, 2),
  );
  expect(byteAudit.violations).toEqual([]);
  const pos = 17;
  await page.getByLabel("Byte position").press("Home");
  for (let i = 0; i < pos; i++)
    await page.getByLabel("Byte position").press("ArrowRight");
  const inputHex = raw[pos].toString(16).padStart(2, "0");
  await expect(page.locator(".bit-row").nth(0).locator("code")).toHaveText(
    inputHex,
  );
  const streamHex = await page
      .locator(".bit-row")
      .nth(1)
      .locator("code")
      .innerText(),
    cipherHex = await page
      .locator(".bit-row")
      .nth(2)
      .locator("code")
      .innerText();
  expect(parseInt(inputHex, 16) ^ parseInt(streamHex, 16)).toBe(
    parseInt(cipherHex, 16),
  );
  await page.locator(".bit-inspector").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../evidence/real-bit-equation.png" });
  await page.locator(".live-body").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: "../evidence/real-encryption-transformation.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Stored envelope", exact: true })
    .click();
  await expect(page.locator(".envelope-strip")).toContainText("12 bytes");
  await expect(page.locator(".envelope-strip")).toContainText("16 bytes");
  await page
    .getByRole("button", { name: "Keys & signature", exact: true })
    .click();
  await expect(page.locator(".key-signature-view")).toContainText("RSA-OAEP");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export measured trace/ }).click();
  const file = await dl;
  const exported = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
  expect(exported.local).toBeUndefined();
  expect(JSON.stringify(exported)).not.toContain(
    raw.subarray(0, 32).toString("hex"),
  );
  const encryption = exported.steps.find(
    (s) => s.name === "Encrypt document with AES-GCM",
  );
  expect(encryption.facts.xor_verified).toBe(true);
  expect(encryption.facts.ciphertext_window.slice(pos * 2, pos * 2 + 2)).toBe(
    cipherHex,
  );
  await page
    .getByRole("button", { name: "Byte transformation", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.locator(".live-body").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: "../evidence/real-encryption-mobile.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "Close live view" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Search documents").fill(filename);
  page.once("dialog", (d) => d.accept());
  await page.getByTitle("Delete document").click();
  await status(/Completed/);
  await page.getByRole("button", { name: "Close live view" }).click();
  await page.getByTitle("Sign out").click();
  expect(errors).toEqual([]);
});
