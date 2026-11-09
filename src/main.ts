import { Notice, Platform, Plugin, PluginSettingTab, Setting } from "obsidian";
import { SyncModal } from "./ui/SyncModal";
import { getCurrentVaultPath, isSamePath, listVaults, vaultDisplayName } from "./vaults";

interface VpsSettings {
	/** 拉取模式：上次选择的源仓库（obsidian.json 里的 vault id） */
	sourceVaultId: string;
	/** 推送/拉取：是否连同插件设置 data.json 一起复制 */
	copySettings: boolean;
	/** 推送模式：版本不同的插件默认跳过（取消勾选 = 以当前仓库为准覆盖） */
	skipVersionDiff: boolean;
	/** 推送模式：上次推送的目标仓库 id 列表 */
	pushTargets: string[];
}

const DEFAULT_SETTINGS: VpsSettings = {
	sourceVaultId: "",
	copySettings: false,
	skipVersionDiff: true,
	pushTargets: [],
};

export default class VaultPluginSyncPlugin extends Plugin {
	settings!: VpsSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		// manifest 已声明 isDesktopOnly，这里双保险
		if (!Platform.isDesktopApp) {
			new Notice("Vault Plugin Sync 仅支持桌面端");
			return;
		}

		// 默认入口：仓库总览（查看各仓库插件清单 + 按仓库挑选安装）
		this.addRibbonIcon("refresh-cw", "仓库插件总览", () => this.openSyncPanel("overview"));
		this.addCommand({
			id: "vault-overview",
			name: "查看所有仓库的插件总览（可按仓库安装）",
			callback: () => this.openSyncPanel("overview"),
		});
		this.addCommand({
			id: "push-plugins",
			name: "推送当前仓库插件到其他仓库",
			callback: () => this.openSyncPanel("push"),
		});
		this.addCommand({
			id: "pull-plugins",
			name: "从其他仓库拉取插件到当前仓库",
			callback: () => this.openSyncPanel("pull"),
		});
		this.addSettingTab(new VpsSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	openSyncPanel(mode: "overview" | "push" | "pull" = "overview"): void {
		new SyncModal(this.app, this, mode).open();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class VpsSettingTab extends PluginSettingTab {
	constructor(app: import("obsidian").App, private plugin: VaultPluginSyncPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const currentPath = getCurrentVaultPath(this.app);
		const otherVaults = listVaults().filter((v) => !isSamePath(v.path, currentPath));

		new Setting(containerEl).setName("Vault Plugin Sync").setHeading();

		if (otherVaults.length === 0) {
			containerEl.createEl("p", {
				text: "没有找到其他仓库。请先在 Obsidian 里打开过至少两个仓库，再使用本插件。",
				cls: "vps-status",
			});
			return;
		}

		new Setting(containerEl)
			.setName("源仓库")
			.setDesc("同步时以该仓库的插件列表为准")
			.addDropdown((dd) => {
				for (const v of otherVaults) dd.addOption(v.id, vaultDisplayName(v));
				dd.setValue(this.plugin.settings.sourceVaultId || otherVaults[0].id);
				dd.onChange(async (id) => {
					this.plugin.settings.sourceVaultId = id;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("同时复制插件设置")
			.setDesc("推送/拉取共用；开启后 data.json 一并复制，关闭时目标仓库已有设置会被保留")
			.addToggle((tg) => {
				tg.setValue(this.plugin.settings.copySettings);
				tg.onChange(async (val) => {
					this.plugin.settings.copySettings = val;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("仓库插件总览")
				.setCta()
				.onClick(() => new SyncModal(this.app, this.plugin, "overview").open()),
		);

		new Setting(containerEl).addButton((b) =>
			b.setButtonText("推送到其他仓库").onClick(() => new SyncModal(this.app, this.plugin, "push").open()),
		);

		new Setting(containerEl).addButton((b) =>
			b.setButtonText("从其他仓库拉取").onClick(() => new SyncModal(this.app, this.plugin, "pull").open()),
		);

		containerEl.createEl("p", {
			text: "推送只写目标仓库的插件目录和启用列表；版本不同的插件默认跳过（可在面板中改为覆盖）；目标仓库多出的插件不会被改动。",
			cls: "vps-status",
		});
	}
}
