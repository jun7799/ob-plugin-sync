import { Modal, Notice, type App } from "obsidian";
import { computeDiff, DIFF_GROUP_LABELS, type DiffEntry, type DiffKind } from "../diff";
import { pushPlugins, classifyPushAction, type PushItemResult } from "../push";
import { syncSelected, type SyncItemResult } from "../sync";
import type { PluginInfo, VaultEntry } from "../types";
import {
	getCurrentVaultPath,
	isSamePath,
	listVaults,
	readPluginVersion,
	scanVaultPlugins,
	vaultDisplayName,
} from "../vaults";
import type VaultPluginSyncPlugin from "../main";

type SyncMode = "overview" | "push" | "pull";
type PanelState = "loading" | "ready" | "busy" | "error";

/**
 * 同步面板，三种模式：
 * - overview（默认）：扫描所有仓库的插件清单，以仓库为中心查看并挑选安装（每个仓库可选不同组合）
 * - push：当前仓库的插件 → 勾选的多个目标仓库（一批插件分发到多处）
 * - pull：选定源仓库的插件 → 当前仓库
 * UI 从 PanelState 派生；扫描与同步均幂等，可反复执行。
 */
export class SyncModal extends Modal {
	private state: PanelState = "loading";
	private mode: SyncMode;
	private viewEl!: HTMLDivElement;

	// 共享数据
	private vaults: VaultEntry[] = [];

	// push 模式
	private currentPlugins: PluginInfo[] = [];
	private checkedTargets = new Set<string>();
	private checkedPlugins = new Set<string>();
	/** 首次渲染时填默认勾选；重扫/重开面板时保留用户的选择 */
	private pushDefaultsApplied = false;
	private summaryEl: HTMLElement | null = null;
	private pushBtn: HTMLButtonElement | null = null;
	private logEl: HTMLElement | null = null;

	// pull 模式
	private sourceVault: VaultEntry | null = null;
	private entries: DiffEntry[] = [];
	private checked = new Map<string, boolean>();
	private errorMessage = "";
	private resultRows = new Map<string, HTMLDivElement>();

	constructor(app: App, private plugin: VaultPluginSyncPlugin, mode: SyncMode = "overview") {
		super(app);
		this.mode = mode;
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass("vps-modal");
		this.titleEl.setText("插件同步");
		this.renderShell();
		await this.renderActiveView();
	}

	private renderShell(): void {
		const { contentEl } = this;
		contentEl.empty();

		const seg = contentEl.createDiv("vps-segment");
		const mk = (mode: SyncMode, label: string): HTMLButtonElement => {
			const b = seg.createEl("button", { text: label });
			if (this.mode === mode) b.addClass("is-active");
			b.addEventListener("click", () => {
				if (this.mode === mode || this.state === "busy") return;
				this.mode = mode;
				seg.querySelectorAll("button").forEach((el) => el.removeClass("is-active"));
				b.addClass("is-active");
				void this.renderActiveView();
			});
			return b;
		};
		mk("overview", "仓库总览");
		mk("push", "推送到其他仓库");
		mk("pull", "从其他仓库拉取");

		this.viewEl = contentEl.createDiv("vps-view");
	}

	private async renderActiveView(): Promise<void> {
		this.viewEl.empty();
		this.state = "loading";
		this.viewEl.createEl("p", { text: "正在扫描…", cls: "vps-status" });
		await sleep(30); // 先绘制 loading，IO 在本机毫秒级

		const currentPath = getCurrentVaultPath(this.app);
		this.vaults = listVaults().filter((v) => !isSamePath(v.path, currentPath));

		if (this.vaults.length === 0) {
			this.state = "error";
			this.renderError("没有找到其他仓库。请先在 Obsidian 里打开过至少两个仓库。");
			return;
		}
		if (this.mode === "overview") await this.renderOverviewView();
		else if (this.mode === "push") await this.renderPushView();
		else await this.renderPullView();
	}

	private renderError(message: string): void {
		this.viewEl.empty();
		this.viewEl.createEl("p", { text: message, cls: "vps-status is-error" });
		const retry = this.viewEl.createEl("button", { text: "重试" });
		retry.addEventListener("click", () => void this.renderActiveView());
	}

	// ============================== overview ==============================

	/** 以仓库为中心的总览：每个仓库的插件清单 + 从当前仓库挑选安装（各仓库可不同组合） */
	private async renderOverviewView(): Promise<void> {
		const currentPlugins = scanVaultPlugins(getCurrentVaultPath(this.app), this.app.vault.configDir);

		interface VaultGroup {
			vault: VaultEntry;
			plugins: PluginInfo[];
			/** 当前仓库有、该仓库没有 → 可安装项 */
			missing: PluginInfo[];
		}
		const groups: VaultGroup[] = this.vaults.map((v) => {
			const plugins = scanVaultPlugins(v.path);
			const missing = computeDiff(currentPlugins, plugins)
				.filter((e) => e.kind === "install")
				.map((e) => e.source!);
			return { vault: v, plugins, missing };
		});
		// 行动导向：缺失最多的仓库排前面，便于逐个补齐
		groups.sort(
			(a, b) =>
				b.missing.length - a.missing.length ||
				vaultDisplayName(a.vault).localeCompare(vaultDisplayName(b.vault), "zh-Hans-CN"),
		);

		this.state = "ready";
		const wrap = this.viewEl;
		wrap.empty();

		const withPlugins = groups.filter((g) => g.plugins.length > 0).length;
		wrap.createDiv({
			text: `共 ${groups.length} 个仓库，${withPlugins} 个装了插件，当前仓库有 ${currentPlugins.length} 个插件。展开仓库可查看清单，并从当前仓库挑选插件安装（每个仓库可选不同组合）。`,
			cls: "vps-ov-stats",
		});

		for (const g of groups) {
			const details = wrap.createEl("details", { cls: "vps-vault-group" });
			// 缺失最多的仓库默认展开，其余折叠
			if (g.missing.length > 0 && groups[0] === g) details.open = true;

			const summary = details.createEl("summary");
			summary.createSpan({ text: vaultDisplayName(g.vault), cls: "vps-vault-name" });
			summary.createSpan({ text: `${g.plugins.length} 已装`, cls: "vps-count-badge" });
			if (g.missing.length > 0) {
				summary.createSpan({ text: `缺 ${g.missing.length}`, cls: "vps-count-badge is-missing" });
			}

			const body = details.createDiv("vps-vault-body");

			body.createDiv({ text: "已装插件", cls: "vps-group-title" });
			if (g.plugins.length > 0) {
				for (const p of g.plugins) {
					const row = body.createDiv("vps-item is-readonly");
					const info = row.createDiv("vps-item-info");
					const titleLine = info.createDiv("vps-item-title");
					titleLine.createSpan({ text: p.name, cls: "vps-item-name" });
					titleLine.createSpan({ text: p.id, cls: "vps-item-id" });
					info.createDiv("vps-item-meta").appendText(`v${p.version} · ${p.enabled ? "已启用" : "未启用"}`);
				}
			} else {
				body.createDiv({ text: "未安装任何插件", cls: "vps-item-meta" });
			}

			if (g.missing.length > 0) {
				body.createDiv({ text: "可从当前仓库安装", cls: "vps-group-title" });
				const checked = new Set<string>();
				for (const p of g.missing) {
					const row = body.createDiv("vps-check-row");
					const cb = row.createEl("input", { type: "checkbox" });
					cb.dataset.pluginId = p.id;
					cb.addEventListener("change", () => {
						if (cb.checked) checked.add(p.id);
						else checked.delete(p.id);
					});
					const label = row.createDiv("vps-check-label");
					label.createSpan({ text: p.name });
					label.createSpan({
						text: ` v${p.version}${p.enabled ? "" : " · 当前未启用"}`,
						cls: "vps-item-id",
					});
				}
				const actions = body.createDiv("vps-vault-actions");
				const btn = actions.createEl("button", { text: "安装所选到该仓库", cls: "mod-cta" });
				btn.addEventListener("click", () => {
					const selected = g.missing.filter((p) => checked.has(p.id));
					void this.runOverviewInstall(btn, g.vault, selected);
				});
			}
		}
	}

	/** 总览里的按仓库安装：只装缺失项，复用推送引擎，不覆盖任何已有插件 */
	private async runOverviewInstall(
		btn: HTMLButtonElement,
		vault: VaultEntry,
		plugins: PluginInfo[],
	): Promise<void> {
		if (plugins.length === 0) {
			new Notice("请先勾选要安装的插件");
			return;
		}
		this.state = "busy";
		this.setBusy(true);
		btn.setText("安装中…");

		const results = await pushPlugins(plugins, [vault], {
			overwrite: false, // 总览只做加法，版本不同的留给推送模式
			copySettings: this.plugin.settings.copySettings,
		});
		const ok = results.filter((r) => r.action === "install").length;
		const failed = results.filter((r) => r.action === "error");
		new Notice(
			`已安装 ${ok} 个插件到「${vaultDisplayName(vault)}」${failed.length ? `，失败 ${failed.length} 个` : ""}。该仓库重载后生效。`,
			6000,
		);
		if (failed.length) console.error("[Cross Vault Sync] 安装失败项:", failed);

		this.state = "ready";
		await this.renderActiveView();
	}

	// ================================ push ================================

	private async renderPushView(): Promise<void> {
		this.currentPlugins = scanVaultPlugins(getCurrentVaultPath(this.app), this.app.vault.configDir);
		if (this.currentPlugins.length === 0) {
			this.state = "error";
			this.renderError("当前仓库没有安装任何社区插件，没有可推送的内容。");
			return;
		}

		this.state = "ready";
		const wrap = this.viewEl;
		wrap.empty();

		// 首次进入：目标仓库恢复上次选择，插件默认勾选已启用的
		if (!this.pushDefaultsApplied) {
			this.checkedTargets = new Set(
				this.vaults.filter((v) => this.plugin.settings.pushTargets.includes(v.id)).map((v) => v.id),
			);
			this.checkedPlugins = new Set(this.currentPlugins.filter((p) => p.enabled).map((p) => p.id));
			this.pushDefaultsApplied = true;
		}

		// 选项行：跳过版本不同 / 含设置（原生 checkbox，紧凑排版）
		const opts = wrap.createDiv("vps-opts");
		const mkOpt = (key: "skipVersionDiff" | "copySettings", label: string): HTMLInputElement => {
			const holder = opts.createDiv("vps-opt");
			const cb = holder.createEl("input", { type: "checkbox" });
			cb.checked = this.plugin.settings[key];
			cb.id = `vps-opt-${key}`;
			cb.addEventListener("change", () => {
				this.plugin.settings[key] = cb.checked;
				void this.plugin.saveSettings().then(() => this.updatePushSummary());
			});
			holder.createEl("label", { text: label }).setAttribute("for", cb.id);
			return cb;
		};
		mkOpt("skipVersionDiff", "跳过版本不同的插件");
		mkOpt("copySettings", "同时推送插件设置");

		// 两栏：目标仓库 × 当前仓库插件
		const cols = wrap.createDiv("vps-cols");
		this.renderPushTargetCol(cols.createDiv("vps-col"));
		this.renderPushPluginCol(cols.createDiv("vps-col"));

		// 摘要 + 操作
		this.summaryEl = wrap.createDiv("vps-summary");
		const footer = wrap.createDiv("vps-footer");
		this.pushBtn = footer.createEl("button", { text: "推送到已选仓库", cls: "mod-cta" });
		this.pushBtn.addEventListener("click", () => void this.runPush());
		const refresh = footer.createEl("button", { text: "重新扫描" });
		refresh.addEventListener("click", () => void this.renderActiveView());

		this.logEl = null;
		this.updatePushSummary();
	}

	private renderPushTargetCol(col: HTMLDivElement): void {
		col.createDiv({ text: `目标仓库 · ${this.vaults.length}`, cls: "vps-col-title" });
		this.renderCheckTools(col, (all) => {
			this.checkedTargets.clear();
			if (all) for (const v of this.vaults) this.checkedTargets.add(v.id);
			col.querySelectorAll("input[type=checkbox]").forEach((el) => {
				(el as HTMLInputElement).checked = this.checkedTargets.has((el as HTMLInputElement).dataset.id ?? "");
			});
			this.updatePushSummary();
		});
		const list = col.createDiv("vps-check-list");
		for (const v of this.vaults) {
			const row = list.createDiv("vps-check-row");
			const cb = row.createEl("input", { type: "checkbox" });
			cb.dataset.id = v.id;
			cb.checked = this.checkedTargets.has(v.id);
			cb.addEventListener("change", () => {
				if (cb.checked) this.checkedTargets.add(v.id);
				else this.checkedTargets.delete(v.id);
				this.updatePushSummary();
			});
			row.createSpan({ text: vaultDisplayName(v), cls: "vps-check-label" });
		}
	}

	private renderPushPluginCol(col: HTMLDivElement): void {
		col.createDiv({ text: `当前仓库插件 · ${this.currentPlugins.length}`, cls: "vps-col-title" });
		this.renderCheckTools(col, (all) => {
			this.checkedPlugins.clear();
			if (all) for (const p of this.currentPlugins) this.checkedPlugins.add(p.id);
			col.querySelectorAll("input[type=checkbox]").forEach((el) => {
				(el as HTMLInputElement).checked = this.checkedPlugins.has((el as HTMLInputElement).dataset.id ?? "");
			});
			this.updatePushSummary();
		});
		const list = col.createDiv("vps-check-list");
		for (const p of this.currentPlugins) {
			const row = list.createDiv("vps-check-row");
			const cb = row.createEl("input", { type: "checkbox" });
			cb.dataset.id = p.id;
			cb.checked = this.checkedPlugins.has(p.id);
			cb.addEventListener("change", () => {
				if (cb.checked) this.checkedPlugins.add(p.id);
				else this.checkedPlugins.delete(p.id);
				this.updatePushSummary();
			});
			const label = row.createDiv("vps-check-label");
			label.createSpan({ text: p.name });
			label.createSpan({ text: ` v${p.version}${p.enabled ? "" : " · 未启用"}`, cls: "vps-item-id" });
		}
	}

	private renderCheckTools(col: HTMLDivElement, apply: (selectAll: boolean) => void): void {
		const tools = col.createDiv("vps-col-tools");
		const mk = (text: string, all: boolean): void => {
			const b = tools.createEl("button", { text, cls: "vps-link-btn" });
			b.addEventListener("click", () => apply(all));
		};
		mk("全选", true);
		mk("清空", false);
	}

	/** 实时摘要：对勾选的 插件×仓库 组合逐项预判动作，量小直接全算 */
	private updatePushSummary: () => void = () => {
		if (!this.summaryEl) return;
		const plugins = this.currentPlugins.filter((p) => this.checkedPlugins.has(p.id));
		const targets = this.vaults.filter((v) => this.checkedTargets.has(v.id));
		if (plugins.length === 0 || targets.length === 0) {
			this.summaryEl.setText("请在两栏中勾选要推送的插件和目标仓库。");
			return;
		}
		let install = 0;
		let overwrite = 0;
		let downgrade = 0;
		for (const v of targets) {
			for (const p of plugins) {
				const r = classifyPushAction(p.version, this.readVaultPluginVersion(v, p.id), !this.plugin.settings.skipVersionDiff);
				if (r.action === "install") install++;
				else if (r.action === "overwrite") overwrite++;
				if (r.downgrade) downgrade++;
			}
		}
		const parts = [
			`将推送 ${plugins.length} 个插件到 ${targets.length} 个仓库`,
			`安装 ${install}`,
			overwrite > 0 ? `覆盖 ${overwrite}${downgrade > 0 ? `（降级 ${downgrade}）` : ""}` : "",
			`其余跳过`,
		].filter(Boolean);
		this.summaryEl.setText(parts.join(" · "));
	};

	/** 读任意仓库某插件版本（push 摘要预判用，读不到返回 undefined） */
	private readVaultPluginVersion(v: VaultEntry, pluginId: string): string | undefined {
		return readPluginVersion(v.path, pluginId);
	}

	private async runPush(): Promise<void> {
		const plugins = this.currentPlugins.filter((p) => this.checkedPlugins.has(p.id));
		const targets = this.vaults.filter((v) => this.checkedTargets.has(v.id));
		if (plugins.length === 0 || targets.length === 0) {
			new Notice("请先勾选要推送的插件和目标仓库");
			return;
		}

		this.state = "busy";
		this.setBusy(true);

		this.logEl = this.viewEl.createDiv("vps-log");
		const appendLog = (r: PushItemResult): void => {
			const label =
				r.action === "install"
					? "[安装]"
					: r.action === "overwrite"
						? `[覆盖]${r.downgrade ? "[降级警示]" : ""}`
						: r.action === "same"
							? "[已一致]"
							: r.action === "skip-diff"
								? "[跳过：版本不同]"
								: `[ERROR] ${r.message ?? ""}`;
			const line = this.logEl!.createDiv({ cls: `vps-log-line${r.action === "error" ? " is-error" : ""}` });
			line.setText(`${r.vaultName} ← ${r.pluginName} ${label}`);
			this.logEl!.scrollTo({ top: this.logEl!.scrollHeight });
		};

		// 记住本次目标选择，下次打开默认恢复
		this.plugin.settings.pushTargets = targets.map((v) => v.id);
		await this.plugin.saveSettings();

		const results = await pushPlugins(
			plugins,
			targets,
			{
				overwrite: !this.plugin.settings.skipVersionDiff,
				copySettings: this.plugin.settings.copySettings,
			},
			(_done, _total, r) => appendLog(r),
		);

		const ok = results.filter((r) => r.action === "install" || r.action === "overwrite").length;
		const failed = results.filter((r) => r.action === "error");
		new Notice(`推送完成：${ok} 项生效${failed.length ? `，失败 ${failed.length} 项` : ""}。已打开的仓库重载后生效。`, 6000);
		if (failed.length) console.error("[Cross Vault Sync] 推送失败项:", failed);

		this.state = "ready";
		this.setBusy(false);
	}

	private setBusy(busy: boolean): void {
		this.viewEl.querySelectorAll("input[type=checkbox], button").forEach((el) => {
			if (el.closest(".vps-segment")) return; // 模式切换按钮单独处理
			(el as HTMLInputElement | HTMLButtonElement).disabled = busy;
		});
		this.viewEl.querySelectorAll(".vps-segment button").forEach((el) => {
			(el as HTMLButtonElement).disabled = busy;
		});
		if (this.pushBtn) this.pushBtn.setText(busy ? "推送中…" : "推送到已选仓库");
	}

	// ================================ pull ================================

	private async renderPullView(): Promise<void> {
		const savedId = this.plugin.settings.sourceVaultId;
		this.sourceVault = this.vaults.find((v) => v.id === savedId) ?? this.vaults[0];

		try {
			const sourcePlugins = scanVaultPlugins(this.sourceVault.path);
			const currentPlugins = scanVaultPlugins(getCurrentVaultPath(this.app), this.app.vault.configDir);
			this.entries = computeDiff(sourcePlugins, currentPlugins);
			this.checked.clear();
			// target-only 条目没有 source（只有 target），勾选状态只给可同步的条目建
			for (const e of this.entries) {
				if (e.source) this.checked.set(e.source.id, e.defaultChecked);
			}
			this.state = "ready";
		} catch (e) {
			this.state = "error";
			this.renderError(e instanceof Error ? e.message : String(e));
			return;
		}

		const wrap = this.viewEl;
		wrap.empty();

		// 顶栏：源仓库选择 + 设置开关
		const optBar = wrap.createDiv("vps-opts");
		const srcHolder = optBar.createDiv("vps-opt vps-opt-grow");
		srcHolder.createEl("label", { text: "源仓库" }).setAttribute("for", "vps-pull-source");
		const select = srcHolder.createEl("select");
		for (const v of this.vaults) {
			const opt = select.createEl("option", { text: vaultDisplayName(v) });
			opt.value = v.id;
		}
		select.value = this.sourceVault.id;
		select.addEventListener("change", () => {
			const next = this.vaults.find((v) => v.id === select.value);
			if (!next) return;
			this.sourceVault = next;
			this.plugin.settings.sourceVaultId = next.id;
			void this.plugin.saveSettings().then(() => this.renderActiveView());
		});

		const setHolder = optBar.createDiv("vps-opt");
		const setCb = setHolder.createEl("input", { type: "checkbox" });
		setCb.checked = this.plugin.settings.copySettings;
		setCb.id = "vps-pull-copysettings";
		setHolder.createEl("label", { text: "同时复制插件设置" }).setAttribute("for", setCb.id);
		setCb.addEventListener("change", () => {
			this.plugin.settings.copySettings = setCb.checked;
			void this.plugin.saveSettings();
		});

		this.renderPullList();
		this.renderPullFooter();
	}

	private renderPullList(): void {
		const groups: DiffKind[] = ["install", "version-diff", "target-only", "same"];
		const listEl = this.viewEl.createDiv("vps-list");
		for (const kind of groups) {
			const groupEntries = this.entries.filter((e) => e.kind === kind);
			if (groupEntries.length === 0) continue;

			const groupEl = listEl.createDiv("vps-group");
			groupEl.createDiv({
				text: `${DIFF_GROUP_LABELS[kind]} · ${groupEntries.length}`,
				cls: "vps-group-title",
			});
			for (const entry of groupEntries) {
				groupEl.appendChild(this.renderPullRow(entry));
			}
		}
		if (this.entries.length === 0) {
			listEl.createEl("p", { text: "源仓库和当前仓库的插件完全一致。", cls: "vps-status" });
		}
	}

	private renderPullRow(entry: DiffEntry): HTMLDivElement {
		const plugin = entry.source ?? entry.target!;
		const row = createDiv({ cls: "vps-item" });
		this.resultRows.set(plugin.id, row);

		const info = row.createDiv("vps-item-info");
		const titleLine = info.createDiv("vps-item-title");
		titleLine.createSpan({ text: plugin.name, cls: "vps-item-name" });
		titleLine.createSpan({ text: plugin.id, cls: "vps-item-id" });

		const metaLine = info.createDiv("vps-item-meta");
		if (entry.kind === "version-diff") {
			metaLine.appendText(`源 ${entry.source!.version} → 当前 ${entry.target!.version}`);
		} else {
			metaLine.appendText(`v${plugin.version}${plugin.enabled ? " · 源已启用" : " · 源未启用"}`);
		}

		if (entry.kind === "install") {
			row.createDiv({ text: "新增", cls: "vps-badge" });
		} else if (entry.kind === "version-diff") {
			row.createDiv({
				text: entry.isDowngrade ? "降级" : "更新",
				cls: entry.isDowngrade ? "vps-badge is-downgrade" : "vps-badge",
			});
		}

		if (entry.kind === "install" || entry.kind === "version-diff") {
			const cb = createEl("input", { type: "checkbox" });
			cb.checked = this.checked.get(plugin.id) ?? false;
			cb.addEventListener("change", () => {
				this.checked.set(plugin.id, cb.checked);
				this.updatePullSummary();
			});
			row.prepend(cb);
		} else {
			row.addClass("is-readonly");
		}
		return row;
	}

	private renderPullFooter(): void {
		const footer = this.viewEl.createDiv("vps-footer");
		const summary = footer.createSpan({ cls: "vps-summary" });

		const syncBtn = createEl("button", { text: "同步所选", cls: "mod-cta" });
		footer.appendChild(syncBtn);
		syncBtn.addEventListener("click", () => void this.runPullSync(syncBtn));

		const refreshBtn = createEl("button", { text: "重新扫描" });
		footer.appendChild(refreshBtn);
		refreshBtn.addEventListener("click", () => void this.renderActiveView());

		this.updatePullSummary = (): void => {
			const selected = this.entries.filter(
				(e) => (e.kind === "install" || e.kind === "version-diff") && this.checked.get(e.source!.id),
			);
			const overwriteCount = selected.filter((e) => e.kind === "version-diff").length;
			const parts = [`已选 ${selected.length} 项`];
			if (overwriteCount > 0) parts.push(`其中覆盖 ${overwriteCount} 项`);
			if (this.plugin.settings.copySettings) parts.push("含设置");
			summary.setText(parts.join(" · "));
		};
		this.updatePullSummary();
	}

	private updatePullSummary: () => void = () => {};

	private async runPullSync(btn: HTMLButtonElement): Promise<void> {
		const tasks = this.entries
			.filter(
				(e) => (e.kind === "install" || e.kind === "version-diff") && this.checked.get(e.source!.id),
			)
			.map((e) => ({ plugin: e.source!, enable: e.source!.enabled }));

		if (tasks.length === 0) {
			new Notice("请先勾选要同步的插件");
			return;
		}

		this.state = "busy";
		this.setBusy(true);
		btn.setText(`同步中 0/${tasks.length}`);

		const markRow = (r: SyncItemResult): void => {
			const row = this.resultRows.get(r.id);
			if (!row) return;
			const label =
				r.status === "ok" ? "[OK]" : r.status === "skipped" ? "[跳过]" : `[ERROR] ${r.message ?? ""}`;
			row.querySelector(".vps-item-meta")?.appendText(` ${label}`);
			row.addClass(r.status === "error" ? "is-error" : "is-done");
		};

		const results = await syncSelected(
			this.app,
			tasks,
			{ overwrite: true, copySettings: this.plugin.settings.copySettings },
			(done, total, r) => {
				btn.setText(`同步中 ${done}/${total}`);
				markRow(r);
			},
		);

		const ok = results.filter((r) => r.status === "ok").length;
		const failed = results.filter((r) => r.status === "error");
		new Notice(`同步完成：成功 ${ok} 项${failed.length ? `，失败 ${failed.length} 项` : ""}`, 5000);
		if (failed.length) console.error("[Cross Vault Sync] 同步失败项:", failed);

		this.state = "ready";
		this.setBusy(false);
		btn.setText("同步所选");
		await sleep(1200);
		await this.renderActiveView();
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
