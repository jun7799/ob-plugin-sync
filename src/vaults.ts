import fs from "fs";
import os from "os";
import path from "path";
import { FileSystemAdapter, type App } from "obsidian";
import type { PluginInfo, VaultEntry } from "./types";

/**
 * 外部 vault 的配置目录。Obsidian 允许用户自定义 configDir，
 * 但该值只能通过当前会话的 Vault API 读取，对其他 vault 不可得，
 * 因此访问非当前 vault 时统一使用默认目录名。
 */
export const DEFAULT_CONFIG_DIR = ".obsidian";

/** 读取 JSON 文件并断言为目标类型；文件缺失或损坏时返回 null（收敛 JSON.parse 的 any 传播） */
export function readJsonAs<T>(filePath: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
	} catch {
		return null;
	}
}

/** Obsidian 全局配置 obsidian.json 的路径（Win / macOS / Linux） */
export function getObsidianJsonPath(): string {
	if (process.platform === "win32") {
		const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
		return path.join(appData, "obsidian", "obsidian.json");
	}
	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
	}
	return path.join(os.homedir(), ".config", "obsidian", "obsidian.json");
}

/** 读取本机所有 vault（只保留磁盘上真实存在的路径） */
export function listVaults(): VaultEntry[] {
	const raw = readJsonAs<{ vaults?: Record<string, { path?: string; open?: boolean }> }>(getObsidianJsonPath());
	if (!raw) return [];
	const entries: VaultEntry[] = [];
	for (const [id, v] of Object.entries(raw.vaults ?? {})) {
		if (v?.path && fs.existsSync(v.path)) {
			entries.push({ id, path: v.path, open: v.open });
		}
	}
	return entries;
}

/** vault 根路径用于显示的名字（取目录名） */
export function vaultDisplayName(entry: VaultEntry): string {
	return path.basename(entry.path) || entry.path;
}

/**
 * 扫描一个 vault 的插件清单。只读，不修改源 vault 的任何文件。
 * @param vaultRoot vault 根目录绝对路径
 * @param configDir 配置目录名，当前 vault 用 app.vault.configDir，外部 vault 默认 ".obsidian"
 */
export function scanVaultPlugins(vaultRoot: string, configDir = DEFAULT_CONFIG_DIR): PluginInfo[] {
	const pluginsRoot = path.join(vaultRoot, configDir, "plugins");
	if (!fs.existsSync(pluginsRoot)) return [];

	// 启用列表：community-plugins.json 是插件 id 数组，损坏时按全部未启用处理
	let enabledIds = new Set<string>();
	const arr = readJsonAs<unknown[]>(path.join(vaultRoot, configDir, "community-plugins.json"));
	if (Array.isArray(arr)) {
		enabledIds = new Set(arr.filter((x): x is string => typeof x === "string"));
	}

	const result: PluginInfo[] = [];
	for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dirPath = path.join(pluginsRoot, entry.name);
		const manifestPath = path.join(dirPath, "manifest.json");
		// 没有 manifest.json 的目录不是有效插件（可能是残留或未完成安装）
		if (!fs.existsSync(manifestPath)) continue;
		const m = readJsonAs<{ id?: unknown; name?: unknown; version?: unknown; author?: unknown }>(manifestPath);
		if (typeof m?.id !== "string" || typeof m?.version !== "string") continue;
		result.push({
			id: m.id,
			name: typeof m.name === "string" ? m.name : m.id,
			version: m.version,
			author: typeof m.author === "string" ? m.author : undefined,
			enabled: enabledIds.has(m.id),
			hasSettings: fs.existsSync(path.join(dirPath, "data.json")),
			dirPath,
		});
	}
	result.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
	return result;
}

/** 当前 vault 的根目录绝对路径（桌面端 FileSystemAdapter） */
export function getCurrentVaultPath(app: App): string {
	return (app.vault.adapter as FileSystemAdapter).getBasePath();
}

/** 读任意仓库里某插件的版本（manifest 缺失/损坏时返回 undefined，视为未安装） */
export function readPluginVersion(
	vaultPath: string,
	pluginId: string,
	configDir = DEFAULT_CONFIG_DIR,
): string | undefined {
	const m = readJsonAs<{ version?: unknown }>(
		path.join(vaultPath, configDir, "plugins", pluginId, "manifest.json"),
	);
	return typeof m?.version === "string" ? m.version : undefined;
}

/** Windows 路径大小写不敏感，统一小写比较 */
export function isSamePath(a: string, b: string): boolean {
	const norm = (p: string) => path.resolve(p).replace(/\/+$/, "").toLowerCase();
	return norm(a) === norm(b);
}
