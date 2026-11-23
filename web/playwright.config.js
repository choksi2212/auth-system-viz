module.exports = {
  testDir: ".",
  testMatch: ["journey.spec.js", "live.spec.js"],
  workers: 1,
  timeout: 90000,
  use: {
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    },
    trace: "retain-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "../evidence/browser-results.json" }],
  ],
};
