# Cross Vault Sync

[English](#english) | [中文](#中文)

## English

Install plugins once, use them everywhere. **Push** plugins from this vault to any of your other vaults, or **pull** from them — with a diff view and per-vault / per-plugin selection. No Git, no symlinks, no cloud service.

### Why

Obsidian keeps plugins per-vault. If you maintain multiple vaults (work / life / demos), you end up installing the same plugins again and again. This plugin installs in **one** vault and manages all the others from there.

### Three modes

- **Vault overview (default)**: scan every vault, see what's installed where, and pick plugins to install per vault — each vault can get a different set. Vaults with the most missing plugins are sorted and expanded first.
- **Push**: check the plugins in the current vault + the target vaults → one click distributes them everywhere. Target vaults need nothing installed. The live summary tells you beforehand how many will be installed / overwritten (with downgrade warnings) / skipped.
- **Pull**: pick a source vault → see the diff (missing / version diff / in sync / only here) → check and sync into the current vault.

### How it works

- Reads the vault list from Obsidian's global `obsidian.json` (the same list as the vault switcher).
- Copies plugin folders via Node `fs` (`cpSync`, supports sub-folders and binary assets). Read-only on the source side.
- Enabling: pull mode uses the BRAT flow (`loadManifests()` + `enablePluginAndSave()`, takes effect immediately); push mode writes the target vault's `community-plugins.json` directly (takes effect when that vault reloads).
- Safety: same-version plugins are skipped; version diffs are skipped by default (opt-in to overwrite); downgrades always carry a red badge; plugins that exist only in target vaults are never touched.
- Plugin settings (`data.json`) are **not** copied by default — opt in via a toggle; existing settings are preserved.

### Usage

1. Command palette → **"推送当前仓库插件到其他仓库"** (push, default) or **"从其他仓库拉取插件到当前仓库"** (pull). Ribbon icon opens push mode.
2. Push: check target vaults (left column) and plugins (right column) → **推送到已选仓库**.
3. Vaults that are currently open need one reload to show the newly pushed plugins.

Desktop only (`isDesktopOnly: true`). No network access, no data leaves your machine.

## 中文

插件装一次，处处可用。把当前仓库的插件**推送**到其他仓库，或从其他仓库**拉取**——带差异对比、按仓库/按插件勾选。不用 Git、不用 symlink、不用云服务。

### 为什么需要它

Obsidian 的插件按仓库隔离。维护多个仓库（工作 / 生活 / 演示）的人，同一批插件要装一遍又一遍。这个插件只装在**一个**主仓库里，就能管理其他所有仓库的插件分发。

### 三种模式

- **仓库总览（默认）**：扫描所有仓库，看每个仓库装了哪些插件，并按仓库挑选安装——每个仓库可以装不同的组合。缺失最多的仓库排在最前并默认展开。
- **推送**：勾选当前仓库的插件 + 目标仓库 → 一键分发。目标仓库什么都不用装。摘要会实时预判：多少项将安装 / 覆盖（含降级警示）/ 跳过。
- **拉取**：选定源仓库 → 看差异（可安装 / 版本不同 / 已一致 / 仅当前库）→ 勾选同步到当前仓库。

### 工作原理

- 从 Obsidian 全局配置 `obsidian.json` 读取仓库列表（就是仓库切换器里看到的那些）。
- 通过 Node `fs`（`cpSync`，支持子目录和二进制资源）复制插件目录；源侧只读。
- 启用方式：拉取走 BRAT 流程（`loadManifests()` + `enablePluginAndSave()`，立即生效）；推送直接写目标仓库的 `community-plugins.json`（目标仓库重载后生效）。
- 安全边界：同版本跳过；版本不同默认跳过（可显式改为覆盖）；降级永远红牌警示；目标仓库多出的插件绝不动。
- 插件设置（`data.json`）**默认不同步**——开关显式开启；目标已有的设置会被保留。

### 用法

1. 命令面板 → **「推送当前仓库插件到其他仓库」**（默认）或 **「从其他仓库拉取插件到当前仓库」**。左侧栏图标直达推送。
2. 推送：左栏勾目标仓库，右栏勾插件 → **推送到已选仓库**。
3. 正在打开的目标仓库，重载一次即可看到新推送的插件。

仅桌面端（`isDesktopOnly: true`）。不联网，数据不出本机。

---

## Development / 开发

```bash
npm install
npm run dev      # watch 构建
npm run build    # 类型检查 + 生产构建
npm test         # diff 纯函数单元测试
```

架构决策记录见 [docs/DESIGN.md](docs/DESIGN.md)。

## License

MIT © AI混子-俊
