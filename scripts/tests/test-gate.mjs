import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runner = fileURLToPath(new URL("../test.sh", import.meta.url));

function probeRunner(args = [], pytestAddopts = "") {
  const tools = mkdtempSync(join(tmpdir(), "golf-gate-guard-"));
  try {
    // A no-argument RED probe reaches the runner's own Node test invocation.
    // Stub that too so a missing guard cannot recursively rerun this suite.
    writeFileSync(join(tools, "node"), "#!/bin/sh\necho GOLF_GATE_CHILD_NODE_REACHED\n", { mode: 0o700 });
    // Reaching installation fails safely without installing or starting servers.
    writeFileSync(join(tools, "uv"), "#!/bin/sh\nexit 97\n", { mode: 0o700 });
    return spawnSync("bash", [runner, ...args], {
      env: {
        ...process.env,
        PATH: `${tools}:${process.env.PATH}`,
        GOLF_KEEP_FAILED_TMP: "0",
        PYTEST_ADDOPTS: pytestAddopts,
      },
      encoding: "utf8",
      timeout: 30_000,
    });
  } finally {
    rmSync(tools, { recursive: true });
  }
}

for (const args of [["--list"], ["--grep", "smoke"], ["tests/smoke.spec.ts"]]) {
  test(`full gate rejects selection ${args.join(" ")} before installing or starting anything`, () => {
    const result = probeRunner(args);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /complete gate.*no.*options/i);
    assert.doesNotMatch(result.stdout, /GOLF_GATE_CHILD_NODE_REACHED|All hermetic tests passed/);
  });
}

for (const options of ["--collect-only", "-k test_production"]) {
  test(`full gate rejects PYTEST_ADDOPTS=${options} before any test or installation`, () => {
    const result = probeRunner([], options);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /complete gate.*PYTEST_ADDOPTS/i);
    assert.doesNotMatch(result.stdout, /GOLF_GATE_CHILD_NODE_REACHED|All hermetic tests passed/);
  });
}

test("full gate permits empty PYTEST_ADDOPTS and reaches the bounded installer stub", () => {
  const result = probeRunner();
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 97, result.stderr || result.stdout);
  assert.match(result.stdout, /GOLF_GATE_CHILD_NODE_REACHED/);
  assert.doesNotMatch(result.stdout, /All hermetic tests passed/);
});
