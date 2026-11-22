const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require("@playwright/test");
const fs = require("fs");
test("complete real vault journey on desktop and mobile", async ({ page }) => {
  const errors = [];
  const externalRequests = [];
  page.on("request", r => {if(!r.url().startsWith("http://localhost:3080"))externalRequests.push(r.url())});
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3080");
  await expect(
    page.getByRole("heading", { name: "Your private space awaits." }),
  ).toBeVisible();
  await expect(page.locator('.form-inner form')).toHaveCSS('opacity','1');
  await page.waitForFunction(() => !document.querySelector('.form-inner form')?.style.transform);
  await page.screenshot({ path: "../evidence/sign-in.png", fullPage: true });
  await page.getByLabel("Email address").fill(
    fs
      .readFileSync("../.env", "utf8")
      .match(/^DEMO_EMAIL=(.+)$/m)[1]
      .trim(),
  );
  await page.getByLabel("Password", { exact: true }).fill("VellumDemo1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A space of your own." }),
  ).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('.page-heading')?.style.transform);
  const accessibility = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  fs.writeFileSync('../evidence/accessibility-results.json', JSON.stringify(accessibility.violations,null,2));
  expect(accessibility.violations).toEqual([]);
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "Design brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A private document. Real encryption, real bytes."),
    });
  await expect(
    page.getByRole("button", { name: "Design brief.txt Encrypted · Signed" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Design brief.txt Encrypted · Signed" })
    .click();
  await page
    .getByRole("button", { name: "Verify document", exact: true })
    .click();
  await expect(
    page.getByText("Signature and integrity verified."),
  ).toBeVisible();
  await page.locator(".close").click();
  const download = page.waitForEvent("download");
  await page.getByTitle("Download document").last().click();
  const file = await download;
  const data = fs.readFileSync(await file.path());
  expect(data.toString()).toBe(
    "A private document. Real encryption, real bytes.",
  );
  await page.screenshot({
    path: "../evidence/vault-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Verify activity history" }).click();
  await expect(page.getByText(/Activity integrity verified/)).toBeVisible();
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Trust, with evidence." }),
  ).toBeVisible();
  await page.screenshot({ path: "../evidence/security.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /My vault/ }).click();
  await page.screenshot({
    path: "../evidence/vault-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A space of your own." }),
  ).toBeVisible();
  await page.getByLabel("Search documents").fill("not-present-123");
  await expect(page.getByText("No documents match your search.")).toBeVisible();
  await page.getByLabel("Search documents").fill("");
  page.once("dialog", (d) => d.accept());
  await page.getByTitle("Delete document").last().click();
  await expect(page.getByText("Document permanently deleted.")).toBeVisible();
  await page.getByTitle("Sign out").click();
  await expect(
    page.getByRole("heading", { name: "Your private space awaits." }),
  ).toBeVisible();
  await expect(page.locator('.form-inner form')).toHaveCSS('opacity','1');
  await page.waitForFunction(() => !document.querySelector('.form-inner form')?.style.transform);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'../evidence/sign-in-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
