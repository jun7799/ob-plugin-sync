import fs from "fs";
import path from "path";
import { FileSystemAdapter, type App } from "obsidian";
import type { AppWithPlugins, PluginInfo } from "./types";

export interface SyncOptions {
	/** 覆盖目标已有的不同版本插件 */
	overwrite: boolean;
	/** 连同源的 data.json（插件设置）一起复制；false 时保留目标已有设置 */
	copySettings: boolean;
}

export interface SyncItemResult {
	id: string;
	name: string;
	status: "ok" | "skipped" | "error";
	message?: string;
}

export interface SyncTask {
	plugin: PluginInfo;
	/** 同步完成后是否自动启用（跟随源 vault 的启用状态） */
	enable: boolean;
}

/**
 * 把源 vault 的一个插件目录复制到当前 vault。
 * 桌面端专用：直接走 Node fs，天然兼容子目录和二进制资源（wasm、图片等）。
 * 只读源目录，只写当前 vault。
 */
export function copyPluginFiles(app: App, sourcePlugin: PluginInfo, opts: SyncOptions): SyncItemResult {
	const { id, name } = sourcePlugin;
	const targetDir = path.join(
		(app.vault.adapter as FileSystemAdapter).getBasePath(),
		app.vault.configDir,
		"plugins",
		id,
	);
	const alreadyInstalled = fs.existsSync(path.join(targetDir, "manifest.json"));
	if (alreadyInstalled && !opts.overwrite) {
		return { id, name, status: "skipped", message: "目标已存在且未勾选覆盖" };
	}
	try {
		fs.mkdirSync(targetDir, { recursive: true });
		fs.cpSync(sourcePlugin.dirPath, targetDir, {
			recursive: true,
			// 不复制设置时排除源的 data.json；
			// cpSync 不会删除目标已有文件，目标的 data.json 自然保留
			filter: (src) => opts.copySettings || path.basename(src) !== "data.json",
		});
		return { id, name, status: "ok" };
	} catch (e) {
		return { id, name, status: "error", message: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * 让 Obsidian 识别并启用刚复制的插件（BRAT 验证过的流程）：
 * 写入文件 → loadManifests() 重新扫描 → enablePluginAndSave(id)。
 * 全部走存在性检查，旧版本宿主缺 API 时静默降级。
 */
export async function enablePlugin(app: App, id: string): Promise<void> {
	const plugins = (app as AppWithPlugins).plugins;
	if (!plugins) return;
	try {
		if (typeof plugins.loadManifests === "function") await plugins.loadManifests();
		if (typeof plugins.enablePluginAndSave === "function") {
			await plugins.enablePluginAndSave(id);
		} else if (typeof plugins.enablePlugin === "function") {
			await plugins.enablePlugin(id);
		}
	} catch {
		// 启用失败不回滚文件：插件已就位，用户可到设置里手动开启
	}
}

/**
 * 批量同步：逐项复制，单项失败不中断（部分成功模型），
 * 每完成一项通过 onProgress 回调，供 UI 更新进度。
 */
export async function syncSelected(
	app: App,
	tasks: SyncTask[],
	opts: SyncOptions,
	onProgress?: (done: number, total: number, result: SyncItemResult) => void,
): Promise<SyncItemResult[]> {
	const results: SyncItemResult[] = [];
	for (let i = 0; i < tasks.length; i++) {
		const { plugin, enable } = tasks[i];
		const result = copyPluginFiles(app, plugin, opts);
		if (result.status === "ok" && enable) {
			await enablePlugin(app, plugin.id);
		}
		results.push(result);
		onProgress?.(i + 1, tasks.length, result);
	}
	return results;
}
