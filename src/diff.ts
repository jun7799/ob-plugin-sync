import type { PluginInfo } from "./types";

export type DiffKind = "install" | "version-diff" | "same" | "target-only";

export interface DiffEntry {
	kind: DiffKind;
	source?: PluginInfo;
	target?: PluginInfo;
	/** 默认是否勾选同步：只有「源已启用的缺失插件」默认勾选，覆盖类操作必须用户显式勾选 */
	defaultChecked: boolean;
	/** 目标版本比源新，同步会造成降级 */
	isDowngrade: boolean;
}

/** 宽松版本比较：按 . 和 - 分段取数值，逐段比较；返回正数表示 a 更新 */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(/[.-]/).map((s) => parseInt(s, 10) || 0);
	const pb = b.split(/[.-]/).map((s) => parseInt(s, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

/** 源 vault 与当前 vault 的插件差异（纯函数，便于测试） */
export function computeDiff(source: PluginInfo[], target: PluginInfo[]): DiffEntry[] {
	const targetById = new Map(target.map((p) => [p.id, p]));
	const sourceIds = new Set(source.map((p) => p.id));
	const entries: DiffEntry[] = [];

	for (const s of source) {
		const t = targetById.get(s.id);
		if (!t) {
			entries.push({ kind: "install", source: s, defaultChecked: s.enabled, isDowngrade: false });
		} else if (t.version !== s.version) {
			entries.push({
				kind: "version-diff",
				source: s,
				target: t,
				defaultChecked: false,
				isDowngrade: compareVersions(s.version, t.version) < 0,
			});
		} else {
			entries.push({ kind: "same", source: s, target: t, defaultChecked: false, isDowngrade: false });
		}
	}
	for (const t of target) {
		if (!sourceIds.has(t.id)) {
			entries.push({ kind: "target-only", target: t, defaultChecked: false, isDowngrade: false });
		}
	}

	const order: Record<DiffKind, number> = { install: 0, "version-diff": 1, "target-only": 2, same: 3 };
	const nameOf = (e: DiffEntry) => (e.source ?? e.target)!.name;
	entries.sort((a, b) => order[a.kind] - order[b.kind] || nameOf(a).localeCompare(nameOf(b), "zh-Hans-CN"));
	return entries;
}

/** 对比结果的分组标题文案 */
export const DIFF_GROUP_LABELS: Record<DiffKind, string> = {
	install: "可安装（源仓库有、当前仓库没有）",
	"version-diff": "版本不同（默认不覆盖，勾选后以源仓库为准）",
	same: "已一致",
	"target-only": "仅当前仓库有（不会被改动）",
};
