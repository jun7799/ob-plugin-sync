import fs from "fs";
import path from "path";
import { compareVersions } from "./diff";
import { readPluginVersion } from "./vaults";
import type { PluginInfo, VaultEntry } from "./types";

export interface PushOptions {
	/** 版本不同的插件是否覆盖目标仓库（false = 只推送目标缺失的） */
	overwrite: boolean;
	/** 连同 data.json（插件设置）一起推送 */
	copySettings: boolean;
}

export type PushAction = "install" | "overwrite" | "skip-diff" | "same";

/**
 * 单项推送的动作判定（纯函数，便于测试）。
 * - 目标没有 → install
 * - 目标同版本 → same（内容一致，无需复制）
 * - 目标不同版本：不允许覆盖 → skip-diff；允许覆盖 → overwrite（若源更旧则 downgrade 警示）
 */
export function classifyPushAction(
	sourceVersion: string,
	targetVersion: string | undefined,
	overwrite: boolean,
): { action: PushAction; downgrade: boolean } {
	if (targetVersion === undefined) return { action: "install", downgrade: false };
	if (targetVersion === sourceVersion) return { action: "same", downgrade: false };
	if (!overwrite) return { action: "skip-diff", downgrade: false };
	return { action: "overwrite", downgrade: compareVersions(sourceVersion, targetVersion) < 0 };
}

/** 合并启用列表（纯函数）：把要启用的插件 id 并入目标已有列表，去重保序 */
export function mergeEnabledList(existing: string[], idsToEnable: string[]): string[] {
	const seen = new Set(existing);
	const merged = [...existing];
	for (const id of idsToEnable) {
		if (!seen.has(id)) {
			merged.push(id);
			seen.add(id);
		}
	}
	return merged;
}

export interface PushItemResult {
	vaultName: string;
	pluginId: string;
	pluginName: string;
	action: PushAction | "error";
	downgrade: boolean;
	message?: string;
}

/** 读目标 vault 里某插件的版本（manifest 缺失/损坏时视为未安装） */
function readTargetVersion(target: VaultEntry, pluginId: string): string | undefined {
	return readPluginVersion(target.path, pluginId);
}

/**
 * 推送单个插件到一个目标仓库（只写目标仓库，源目录只读）。
 * 启用方式：直接改目标仓库的 community-plugins.json（目标仓库重载后生效）。
 */
export function pushOnePlugin(
	sourcePlugin: PluginInfo,
	target: VaultEntry,
	opts: PushOptions,
): PushItemResult {
	const base = { vaultName: path.basename(target.path), pluginId: sourcePlugin.id, pluginName: sourcePlugin.name };
	const targetPluginDir = path.join(target.path, ".obsidian", "plugins", sourcePlugin.id);

	const targetVersion = readTargetVersion(target, sourcePlugin.id);
	const { action, downgrade } = classifyPushAction(sourcePlugin.version, targetVersion, opts.overwrite);

	if (action === "same" || action === "skip-diff") {
		return { ...base, action, downgrade: false };
	}

	try {
		fs.mkdirSync(targetPluginDir, { recursive: true });
		fs.cpSync(sourcePlugin.dirPath, targetPluginDir, {
			recursive: true,
			// 不推送设置时排除源的 data.json；目标已有设置自然保留
			filter: (src) => opts.copySettings || path.basename(src) !== "data.json",
		});

		// 源仓库启用的插件 → 写入目标的启用列表
		if (sourcePlugin.enabled) {
			const cpJsonPath = path.join(target.path, ".obsidian", "community-plugins.json");
			let existing: string[] = [];
			try {
				const arr = JSON.parse(fs.readFileSync(cpJsonPath, "utf-8"));
				if (Array.isArray(arr)) existing = arr.filter((x): x is string => typeof x === "string");
			} catch {
				// 目标没有启用列表（全新仓库）或文件损坏，按空列表重建
			}
			const merged = mergeEnabledList(existing, [sourcePlugin.id]);
			if (merged.length !== existing.length) {
				fs.writeFileSync(cpJsonPath, JSON.stringify(merged, null, 2), "utf-8");
			}
		}
		return { ...base, action, downgrade };
	} catch (e) {
		return {
			...base,
			action: "error",
			downgrade: false,
			message: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * 批量推送：当前仓库的一组插件 → 一组目标仓库。
 * 按「仓库 → 插件」逐项执行，单项失败不中断（部分成功模型）。
 */
export async function pushPlugins(
	plugins: PluginInfo[],
	targets: VaultEntry[],
	opts: PushOptions,
	onProgress?: (done: number, total: number, result: PushItemResult) => void,
): Promise<PushItemResult[]> {
	const results: PushItemResult[] = [];
	const total = plugins.length * targets.length;
	let done = 0;
	for (const target of targets) {
		for (const plugin of plugins) {
			const r = pushOnePlugin(plugin, target, opts);
			results.push(r);
			done++;
			onProgress?.(done, total, r);
		}
	}
	return results;
}
