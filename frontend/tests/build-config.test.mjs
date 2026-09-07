import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfig } from "vite";

const config = await resolveConfig({ logLevel: "silent" }, "build");

test("build retains the previous JavaScript and CSS transformation targets", () => {
  // Vite 5's resolved defaults. Preserve syntax output across the major upgrade;
  // this does not prove runtime compatibility or supply browser API polyfills.
  const targets = ["es2020", "edge88", "firefox78", "chrome87", "safari14"];
  assert.deepEqual(config.build.target, targets);
  assert.deepEqual(config.build.cssTarget, targets);
});

test("development server remains loopback-only with an explicit backend proxy", () => {
  assert.equal(config.server.host, "127.0.0.1");
  assert.equal(config.server.strictPort, true);
  assert.equal(config.server.proxy["/api"].target, "http://127.0.0.1:8000");
});
