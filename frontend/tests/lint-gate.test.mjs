import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const frontend = fileURLToPath(new URL("..", import.meta.url));

function lint(source, filename = "src/lint-gate-fixture.ts") {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "--silent", "lint", "--", "--stdin", "--stdin-filename", filename, "--format", "json"],
    { cwd: frontend, input: source, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

test("lint accepts valid typed source", () => {
  const result = lint("export const total: number = 2;\n");
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("lint rejects a debugger statement instead of reporting fake success", () => {
  const result = lint("export function total(): number { debugger; return 2; }\n");
  assert.equal(result.status, 1, "npm run lint must reject representative source defects");
  assert.match(result.stdout, /no-debugger/);
});

test("lint rejects invalid TypeScript syntax", () => {
  const result = lint("export const total: number = ;\n");
  assert.equal(result.status, 1, "invalid syntax must fail the lint gate");
  assert.match(result.stdout, /Parsing error/);
});

test("lint rejects conditionally called React hooks in TSX", () => {
  const result = lint(
    'import { useState } from "react";\n' +
    "export function Chart({ empty }: { empty: boolean }) {\n" +
    "  if (empty) return null;\n" +
    "  const [value] = useState(0);\n" +
    "  return <div>{value}</div>;\n}\n",
    "src/lint-gate-fixture.tsx",
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /react-hooks\/rules-of-hooks/);
});
