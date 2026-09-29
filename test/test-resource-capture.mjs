/**
 * 项目层 resource 捕获：isolate 后的注册不能打进宿主的 mcpResources。
 * 不启动真实 MCP。cordis 只用来证明服务隔离，不依赖 dsh 的 resource 运行时。
 */
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { installProjectResourceCapture } from "../lib/resource-capture.js";

const root = new Context();
const hostCalls = [];
root.provide("mcpResources", {
  register(server) {
    hostCalls.push(server);
    return () => {};
  }
});

const notes = [];
const forgotten = [];
const installed = installProjectResourceCapture(root, {
  note(server, provider) {
    notes.push({ server, provider });
  },
  forget(server, provider) {
    forgotten.push({ server, provider });
  }
});
assert.equal(installed.captured, true, "cordis context accepts isolate/provide");
assert.notStrictEqual(installed.ctx, root);

const provider = { request() {} };
const fiber = await installed.ctx.plugin({
  inject: ["mcpResources"],
  apply(inner) {
    return inner.mcpResources.register("docs", provider);
  }
});
assert.deepEqual(hostCalls, [], "host mcpResources.register is not called");
assert.equal(notes.length, 1);
assert.equal(notes[0].server, "docs");
assert.equal(notes[0].provider, provider);

const hostAgain = await root.plugin({
  inject: ["mcpResources"],
  apply(inner) {
    inner.mcpResources.register("host-only", { request() {} });
  }
});
assert.deepEqual(hostCalls, ["host-only"], "a fiber on the host context still sees the host service");
await hostAgain.dispose();

await fiber.dispose();
assert.equal(forgotten.length, 1);
assert.equal(forgotten[0].server, "docs");
assert.equal(forgotten[0].provider, provider);

const bare = {};
const plain = installProjectResourceCapture(bare, {
  note() {},
  forget() {}
});
assert.equal(plain.captured, false, "missing isolate/provide falls back");
assert.equal(plain.ctx, bare);

console.log("ok resource capture stays off the host service");
await root.fiber.dispose();
