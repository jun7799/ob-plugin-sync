import type { App } from "obsidian";

/** 从一个 vault 扫描出来的单个插件信息 */
export interface PluginInfo {
	id: string;
	name: string;
	version: string;
	author?: string;
	/** 是否在该 vault 的 community-plugins.json 启用列表里 */
	enabled: boolean;
	/** 插件目录里是否带 data.json（设置文件） */
	hasSettings: boolean;
	/** 插件目录的绝对路径 */
	dirPath: string;
}

/** obsidian.json 里登记的一个 vault */
export interface VaultEntry {
	/** obsidian.json 里的随机 key */
	id: string;
	/** vault 根目录绝对路径 */
	path: string;
	open?: boolean;
}

/**
 * app.plugins 的非公开 API。
 * loadManifests / enablePluginAndSave 是 BRAT 等插件多年使用的社区事实标准，
 * 但不在官方类型里，这里自行声明并全部做运行时存在性检查。
 */
export interface AppPluginsInternal {
	loadManifests?(): Promise<void>;
	enablePluginAndSave?(id: string): Promise<void>;
	enablePlugin?(id: string): Promise<void>;
}

export type AppWithPlugins = App & { plugins?: AppPluginsInternal };
