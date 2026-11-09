/**
 * 测试编排：先用 esbuild 把 src/diff.ts 编译成 ESM（零运行时依赖），
 * 再交给 node:test 执行。用法：npm test
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

await build({
	entryPoints: [path.join(root, "..", "src", "diff.ts")],
	outfile: path.join(root, ".build", "diff.mjs"),
	bundle: true,
	format: "esm",
	target: "node18",
	logLevel: "silent",
});

await build({
	entryPoints: [path.join(root, "..", "src", "push.ts")],
	outfile: path.join(root, ".build", "push-core.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node18",
	external: ["fs", "path", "obsidian"],
	logLevel: "silent",
});

const proc = spawnSync(
	process.execPath,
	["--test", path.join(root, "diff.test.mjs"), path.join(root, "push.test.mjs")],
	{ stdio: "inherit" },
);
process.exit(proc.status ?? 1);
