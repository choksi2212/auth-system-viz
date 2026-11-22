module.exports = {
  testDir: ".",
  testMatch: "journey.spec.js",
  timeout: 90000,
  use: { viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  reporter: [
    ["list"],
    ["json", { outputFile: "../evidence/browser-results.json" }],
  ],
};
