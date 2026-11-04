# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

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

[Unreleased]: https://github.com/severalfly/LeonEditor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/severalfly/LeonEditor/releases/tag/v0.1.0
