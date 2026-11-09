import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, computeDiff } from "./.build/diff.mjs";

/** 构造最小 PluginInfo 的辅助函数 */
function plugin(id, version, enabled = true) {
	return { id, name: id, version, author: undefined, enabled, hasSettings: false, dirPath: `/vault/.obsidian/plugins/${id}` };
}

test("compareVersions 按数值分段比较而不是字符串比较", () => {
	assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
	assert.ok(compareVersions("1.2.0", "1.2.0") === 0);
	assert.ok(compareVersions("2.0.0", "1.99.99") > 0);
	assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
});

test("compareVersions 非数字段按 0 处理：1.2.0-beta 与 1.2.0 数值等价", () => {
	assert.equal(compareVersions("1.2.0-beta", "1.2.0"), 0);
	assert.equal(compareVersions("1.0", "1.0.0"), 0);
});

test("源有目标无 → install，源已启用的默认勾选", () => {
	const entries = computeDiff([plugin("a", "1.0.0", true), plugin("b", "1.0.0", false)], []);
	const a = entries.find((e) => e.source?.id === "a");
	const b = entries.find((e) => e.source?.id === "b");
	assert.equal(a.kind, "install");
	assert.equal(a.defaultChecked, true);
	assert.equal(b.kind, "install");
	assert.equal(b.defaultChecked, false);
});

test("版本不同 → version-diff，默认不勾选", () => {
	const entries = computeDiff([plugin("a", "1.3.0")], [plugin("a", "1.2.0")]);
	assert.equal(entries[0].kind, "version-diff");
	assert.equal(entries[0].defaultChecked, false);
	assert.equal(entries[0].isDowngrade, false);
});

test("源版本更旧 → 标记为降级", () => {
	const entries = computeDiff([plugin("a", "1.2.0")], [plugin("a", "1.3.0")]);
	assert.equal(entries[0].kind, "version-diff");
	assert.equal(entries[0].isDowngrade, true);
});

test("版本相同 → same，不可勾选", () => {
	const entries = computeDiff([plugin("a", "1.0.0")], [plugin("a", "1.0.0")]);
	assert.equal(entries[0].kind, "same");
	assert.equal(entries[0].defaultChecked, false);
});

test("仅目标有 → target-only", () => {
	const entries = computeDiff([], [plugin("only-target", "1.0.0")]);
	assert.equal(entries[0].kind, "target-only");
});

test("分组排序：install 在 version-diff 之前", () => {
	const entries = computeDiff(
		[plugin("same", "1.0.0"), plugin("new", "1.0.0"), plugin("diff", "1.1.0")],
		[plugin("same", "1.0.0"), plugin("diff", "1.0.0"), plugin("extra", "1.0.0")],
	);
	assert.deepEqual(
		entries.map((e) => e.kind),
		["install", "version-diff", "target-only", "same"],
	);
});
