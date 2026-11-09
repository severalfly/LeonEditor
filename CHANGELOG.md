# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.2.1] - 2026-11-09

### 修复

- **关闭有未保存修改的标签时，标签会先消失、然后才弹提示。**
  原因是 `window.confirm` 在 WebView2 里会立即返回，原生对话框由宿主稍后绘制，
  于是「关闭」先执行、提示后出现。
  现在改用应用内自绘对话框（`src/lib/confirm.ts` + `ConfirmDialog.vue`），
  await 到用户真正做出选择之后才动状态。
- 同一个问题影响到的其他确认也一并换掉了：全部关闭、文件冲突覆盖、
  跨文件全部替换、当前文件全部替换、恢复默认设置。
  之前这些可能在你还没确认时就已执行。

### 新增

- 关闭未保存的标签时，现在给出**保存 / 不保存 / 取消**三个选项
  （之前只有「确定放弃」和「取消」）。
  未命名的新文件选「保存」会弹出另存为对话框，保存失败则不会关闭标签。
- 全部关闭时同样支持「全部保存 / 全部不保存 / 取消」。

## [0.2.0] - 2026-11-05

### 新增

- **单实例模式**：同一时间只运行一个进程。再次双击 exe、或从资源管理器
  「用 Leon Editor 打开」文件时，会复用已打开的窗口，把文件作为新标签打开，
  并把窗口切到前台。
  需要同时开多个独立窗口时，用 `LeonEditor.exe --new-instance` 启动。
- **软换行开关 `Alt+Z`**：与 VS Code 一致的快捷键，另在工具栏和状态栏各有一个按钮。
- 软换行默认开启，折行后保持原缩进（`wrappingIndent: same`）。
- 换行策略改为 `advanced`，中文（CJK）文本按词折行，不会把字词从中间劈开。

### 变更

- 打包说明文件（README.txt）现在带版本号，并补充单实例与软换行说明。
- 打包脚本从 `tauri.conf.json` 读取版本号，避免手写不一致。

## [0.1.0] - 2026-11-04

首个公开版本。

### 新增

**编辑器核心**
- 多标签编辑（单 Monaco 实例 + 多 model 架构，支持 50+ 标签）
- 打开文件夹，左侧文件树（懒加载、可折叠、按名字过滤、文件类型着色）
- 当前文件查找 / 替换：普通文本、正则、区分大小写、全字匹配、上一个 / 下一个、
  替换、全部替换
- 整个文件夹搜索：多线程并行（rayon + grep-searcher），结果按文件分组，
  点击跳转，支持跨文件批量替换
- `Ctrl+P` 快速打开（文件名模糊匹配 + 子序列匹配）

**编码与换行**
- 自动探测 UTF-8 / UTF-8 BOM / UTF-16 LE / UTF-16 BE / GBK / Big5 / Latin1
- 状态栏可手动切换编码并重新载入
- 识别并转换 LF / CRLF / CR

**文本处理快捷键**
- `Ctrl+Alt+Shift+D` 删除所有换行，合并为一行
- `Ctrl+Alt+Shift+7` 删除所有 `&` 符号并清理多余空格
- `Ctrl+Alt+Shift+L` 转为数据库 `IN (...)` 格式，每行一个值
- 三者均支持「有选区只处理选区，无选区处理全文」，且可 `Ctrl+Z` 撤销

**持久化**
- 未保存内容自动恢复：每 20 秒快照一次，重启后还原所有未保存修改，
  包括从未落盘的新文件
- 会话恢复：打开的标签、光标位置、滚动位置、文件夹
- 便携模式：`portable.dat` 存在时所有数据写在程序同目录

**界面**
- 浅色 / 深色主题
- 系统字体选择器（自动识别等宽字体并置顶）
- 可调侧栏宽度、代码小地图、自动换行、行号、当前行高亮等均可配置

**文件安全**
- 原子写入（临时文件 + 替换）
- 外部修改冲突检测
- 二进制文件识别
- 只读文件识别

### 技术栈

- Tauri 2 + Vue 3 + TypeScript + Vite
- Monaco Editor 0.52
- Rust 后端：encoding_rs / rayon / grep-searcher / walkdir

[Unreleased]: https://github.com/severalfly/LeonEditor/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/severalfly/LeonEditor/releases/tag/v0.2.1
[0.2.0]: https://github.com/severalfly/LeonEditor/releases/tag/v0.2.0
[0.1.0]: https://github.com/severalfly/LeonEditor/releases/tag/v0.1.0
