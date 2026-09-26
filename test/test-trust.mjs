/**
 * 信任门单测：清单读写幂等、projectKey 键控（大小写不敏感的平台上）、
 * TRUST_ALL 逃生舱、isProjectTrusted 谓词。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TRUST_ALL_ENV,
  TRUST_FILE,
  addTrustedProject,
  isProjectTrusted,
  readTrustedProjects,
  removeTrustedProject,
  trustFileIn,
  writeTrustedProjects
} from "../lib/trust.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const dir = await mkdtemp(join(tmpdir(), "dsh-project-mcp-manager-trust-"));
const file = trustFileIn(dir);

try {
  // 1. 缺失文件 = 空清单（首装零信任），坏文件/坏形状同样当空清单
  assert.deepEqual(await readTrustedProjects(join(dir, "missing.json")), [], "missing file reads as empty");
  await writeFile(file, "not-an-array", "utf8");
  assert.deepEqual(await readTrustedProjects(file), [], "non-array file reads as empty");
  await writeFile(file, "{broken json", "utf8");
  assert.deepEqual(await readTrustedProjects(file), [], "broken json reads as empty");

  // 2. add 幂等 + 排序去重；remove 幂等
  const afterAdd = await addTrustedProject(file, "/work/beta");
  const afterAdd2 = await addTrustedProject(file, "/work/alpha");
  const afterDup = await addTrustedProject(file, "/work/alpha");
  assert.deepEqual(afterAdd2, ["/work/alpha", "/work/beta"], "add sorts and dedupes");
  assert.equal(afterDup.length, 2, "re-adding an existing root is a no-op");
  const doc = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(doc, ["/work/alpha", "/work/beta"], "file is a sorted JSON array");
  const afterRemove = await removeTrustedProject(file, "/work/alpha");
  assert.deepEqual(afterRemove, ["/work/beta"], "remove drops the root");
  assert.equal((await removeTrustedProject(file, "/work/alpha")).length, 1, "removing an absent root is a no-op");
  pass("trust list add/remove are idempotent, sorted, JSON-array shaped");

  // 3. 键控与逃生舱
  assert.equal(isProjectTrusted(["/work/beta"], "/work/beta"), true, "exact key trusted");
  assert.equal(isProjectTrusted(["/work/beta"], "/work/other"), false, "unlisted key untrusted");
  assert.equal(isProjectTrusted([], "/anything", { [TRUST_ALL_ENV]: "1" }), true, "TRUST_ALL trusts everything");
  assert.equal(isProjectTrusted(["/work/beta"], "/work/beta", { [TRUST_ALL_ENV]: "1" }), true, "TRUST_ALL is a superset");
  pass("isProjectTrusted keys by projectKey and honours TRUST_ALL");

  // 4. 文件名常量
  assert.equal(TRUST_FILE, "mcp-trusted.json", "trust file name is stable");
  assert.equal(trustFileIn("/home/x/.dsh"), join("/home/x/.dsh", "mcp-trusted.json"), "trust file lives in dshHome");
  pass("trust file location constants");
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, 0 failed`);
console.log("ALL TRUST TESTS PASSED");
