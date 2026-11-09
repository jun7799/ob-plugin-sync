import test from "node:test";
import assert from "node:assert/strict";
import { classifyPushAction, mergeEnabledList } from "./.build/push-core.mjs";

test("classifyPushAction：目标未安装 → install", () => {
	assert.deepEqual(classifyPushAction("1.0.0", undefined, false), { action: "install", downgrade: false });
	assert.deepEqual(classifyPushAction("1.0.0", undefined, true), { action: "install", downgrade: false });
});

test("classifyPushAction：版本相同 → same，与覆盖开关无关", () => {
	assert.deepEqual(classifyPushAction("1.2.0", "1.2.0", false), { action: "same", downgrade: false });
	assert.deepEqual(classifyPushAction("1.2.0", "1.2.0", true), { action: "same", downgrade: false });
});

test("classifyPushAction：版本不同且未开覆盖 → skip-diff", () => {
	assert.deepEqual(classifyPushAction("1.3.0", "1.2.0", false), { action: "skip-diff", downgrade: false });
});

test("classifyPushAction：版本不同且开覆盖 → overwrite，源更旧时标记降级", () => {
	assert.deepEqual(classifyPushAction("1.3.0", "1.2.0", true), { action: "overwrite", downgrade: false });
	assert.deepEqual(classifyPushAction("1.2.0", "1.3.0", true), { action: "overwrite", downgrade: true });
});

test("mergeEnabledList：去重保序合并", () => {
	assert.deepEqual(mergeEnabledList(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
	assert.deepEqual(mergeEnabledList([], ["x"]), ["x"]);
	assert.deepEqual(mergeEnabledList(["a"], []), ["a"]);
});
