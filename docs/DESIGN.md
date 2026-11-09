# 设计决策记录（DESIGN.md）

按乔木方法论（qiaomu-obsidian-dev）输出合同记录。日期：2026-11-09。

## Assessment（评估结论）

- **痛点**：Obsidian 插件按 vault 隔离，多 vault 用户（本机实测 18 个）需逐仓库重装插件；官方无此功能，Obsidian Sync 为跨设备付费方案，不对口。
- **竞品**：均为 workaround（symlink、手动复制 `.obsidian/plugins`、Git 全量同步、网盘）；无专用插件，空位成立。
- **结论：Go**。主类型「命令/自动化（批处理）」+ 副类型「导入」；首要风险：目标错误、不可撤销覆盖。

## 技术路线决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 同步机制 | **复制式**（fs.cpSync） | symlink 会强制共享 data.json（各库设置被迫一致）、Windows 需管理员权限、无法选择性同步；复制式 = 手动安装的自动化，可控可恢复 |
| 读写方式 | 源用 Node `fs` 只读；目标也用 `fs` 直写 | isDesktopOnly，无移动端包袱；比 adapter 逐文件写更简单，且天然支持子目录与二进制资源 |
| 配置目录 | `app.vault.configDir`（当前库）、默认 `.obsidian`（源库） | 跟随 BRAT 惯例，不硬编码 |
| 启用流程 | `loadManifests()` → `enablePluginAndSave()`，缺 API 时降级 `enablePlugin`，再失败则提示手动 | BRAT 多年验证的社区事实标准；全部做运行时存在性检查 |
| 版本策略 | 版本不同默认不勾选；降级标红牌 | 防降级、防意外覆盖；覆盖必须显式勾选 |
| 设置同步 | data.json 默认排除，开关显式开启 | 插件设置可能含路径等本库相关内容，是最大坑点，默认保守 |
| 失败模型 | 逐插件独立复制，单项失败不中断 | 部分成功模型；结果逐行反馈，重跑幂等 |

## 架构

```
src/
  types.ts        # PluginInfo / VaultEntry / app.plugins 非公开 API 的最小声明
  vaults.ts       # obsidian.json 解析（三平台路径）、vault 插件扫描（只读）、路径比较
  diff.ts         # 纯函数差异计算 + 宽松版本比较（零依赖，可单测）
  sync.ts         # 复制引擎（cpSync + data.json 过滤）+ 启用流程 + 批量同步
  ui/SyncModal.ts # 面板：loading/ready/syncing/error 状态机，分组列表，进度标注
  main.ts         # 入口：命令、ribbon、设置页（源仓库选择 + 设置开关）
```

## Verification（验证证据分层）

| 层级 | 状态 | 证据 |
| --- | --- | --- |
| 单元测试（diff + push 纯函数） | ✅ 通过 | `npm test` 13/13（差异分类、推送动作判定、启用列表合并、降级标记） |
| 类型检查 + 构建 | ✅ 通过 | `tsc --noEmit` + esbuild，main.js 产物生成 |
| 真实数据预检（不进 Obsidian） | ✅ 通过 | Node 只读扫描本机：18 vault 全识别，中文路径正常，8 vault 有插件 |
| 真实宿主验证 | ⏳ 待做 | v1.1.0 已部署到 D:\求职：重载 → 推送面板 → 勾选目标仓库与插件 → 推送 → 目标仓库重载后插件出现并启用 |
| 移动端 | ❌ 不支持 | isDesktopOnly: true（跨 vault 访问依赖 Node fs） |

## v1.1.0 变更：推送模式（主模式）

- **动机**：拉取模式存在自我矛盾——新仓库要先手动装一次本插件才能拉取；推送模式把安装成本收敛到单一主仓库。
- **交互**：面板顶部 segment 切换「推送 / 拉取」；推送视图两栏（目标仓库 × 当前插件），摘要实时预判（安装 n / 覆盖 n·降级 n / 其余跳过）。
- **技术差异（推送 vs 拉取）**：
  - 推送无法调用 `app.plugins.*`（只管当前窗口）→ 启用改为直接写目标仓库 `community-plugins.json`（`mergeEnabledList` 去重保序），目标仓库重载后生效。
  - 拉取走 `enablePluginAndSave()` 可立即启用。
  - 两者共用 `fs.cpSync` 复制引擎与 data.json 过滤策略。
- **默认值**：目标仓库恢复上次选择（settings.pushTargets）；插件默认勾选已启用的；版本不同默认跳过（skipVersionDiff=true，可切为以当前仓库为准覆盖）；降级永远红牌标注。
- **安全边界**：推送只写目标仓库的 `plugins/<id>/` 目录与 `community-plugins.json`；目标多出的插件绝不动；data.json 默认不复制。

## v1.2.0 变更：仓库总览（默认入口）

- **动机**：用户需要「看每个仓库装了什么」+「以仓库为中心挑选安装（各仓库可不同组合）」。总览与推送互补：推送以插件为中心（一批插件 → N 仓库），总览以仓库为中心（一个仓库 ← 挑选插件）。
- **交互**：面板默认打开总览；每个仓库一个可折叠 `<details>`（原生元素，无障碍友好），显示「N 已装 · 缺 M」徽标；缺失最多的仓库默认展开；排序按缺失数降序（行动导向）。
- **实现**：`missing` 复用 `computeDiff(current, vault).filter(kind === 'install')`，无新纯函数；安装复用 `pushPlugins(plugins, [vault], { overwrite: false })`——总览只做加法，版本覆盖留给推送模式。
- **边界**：总览安装固定 `overwrite: false`；安装后自动重扫刷新；启用方式与推送一致（写目标 `community-plugins.json`，重载生效）。

## v1.2.1 修复记录

- **Bug**：拉取视图对所有 diff 条目取 `e.source!.id`，target-only 条目（仅当前仓库有）无 `source` → 真机报 `Cannot read properties of undefined (reading 'id')`。自 v1.0.0 存在，触发条件是当前仓库存在源仓库没有的插件。
- **修复**：只为有 `source` 的条目建勾选状态；复查全部 `.source!/.target!` 断言（7 处均在 kind 过滤或 fallback 保护内）。
- **教训**：`DiffEntry` 的 `source/target` 均可选，UI 层非空断言必须在 kind 过滤之后使用；纯函数单测覆盖不了 UI 层断言滥用，真机冒烟是必要一层。

## Distribution

- 当前阶段：**local**（本地安装验证）。
- 发布（GitHub Release / 官方社区目录）为后续独立阶段，未开始。

## 已知限制 / 后续候选

- 源库 configDir 自定义时按默认 `.obsidian` 探测（自定义者极少数，MVP 不处理）。
- 「仅当前仓库有」仅展示，不提供反向清理（v2 候选）。
- 主题 / 代码片段 / 热键同步：v2 候选。
- 插件 ID 清单导出（dotfiles 风格分享）：v2 候选。
