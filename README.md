# Leon Editor

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-lightgrey)]()
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)]()
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)]()

一个轻量、快速、**免安装**的 Windows 文本 / 代码编辑器。定位类似 Notepad++，但用现代技术栈重做 —— 编辑器内核直接复用 VS Code 的 Monaco。

> 单文件 exe，约 9 MB。双击即用，不写注册表，配置跟程序走。

---

## 下载

到 [**Releases**](../../releases/latest) 页面下载最新的 `LeonEditor-<版本>-portable.zip`，解压到任意目录，双击 `LeonEditor.exe` 即可。

**系统要求**
- Windows 10 / 11（x64）
- WebView2 运行时 — Win11 自带；Win10 若未安装，程序会提示下载（或用下方「离线依赖」包）

解压后目录结构：

```
LeonEditor.exe        ← 主程序
WebView2Loader.dll    ← 运行时依赖，不要删
portable.dat          ← 便携模式开关
README.txt            ← 使用说明
```

**为什么是便携版：** 只要 `portable.dat` 存在，所有配置、会话、未保存内容都写在同目录 `data\` 下，不污染系统。删掉它就会改用 `%APPDATA%`。

---

## 功能

### 核心
- **多标签**：单 Monaco 实例 + 多 model 架构，50+ 标签依然流畅
- **打开文件夹**：左侧文件树，懒加载、可折叠、按名字过滤、文件类型着色
- **查找 / 替换**
  - 当前文件：普通文本、正则、区分大小写、全字匹配、上/下一个、替换、全部替换
  - **整个文件夹**：多线程并行搜索（rayon + grep-searcher），结果按文件分组、点击跳转、支持跨文件批量替换
- **快速打开**：`Ctrl+P` 模糊搜索文件名（子序列匹配）
- **软换行**：默认开启，`Alt+Z` 一键切换。折行后保持原缩进，中文按词折行不劈字
- **单实例**：同一时间只跑一个进程，再次打开文件会复用已有窗口
- **未保存内容自动恢复**：重启后所有未保存的修改原样回来，包括从未落盘的新文件
- **系统字体选择**：从系统实际安装的字体里选（自动识别等宽字体并置顶）
- **编码**：自动探测 UTF-8 / UTF-8 BOM / UTF-16 LE/BE / GBK / Big5 / Latin1，状态栏可手动切换并重载
- **换行符**：识别 LF / CRLF / CR，可转换
- **语法高亮**：SQL、Java、Python、JS/TS、Vue、Go、Rust、C/C++、C#、PHP、Ruby、Kotlin、Swift、Shell、PowerShell、Batch、YAML、JSON、XML/HTML、CSS/SCSS/Less、Markdown、INI/properties、Dockerfile、Makefile、Diff、Lua、Perl、R、Dart、Proto、GraphQL、HCL/Terraform 等 40+

### 文本处理快捷键（数据核对 / DBA 场景）

| 快捷键 | 作用 | 示例 |
|---|---|---|
| `Ctrl+Alt+Shift+D` | 删除所有换行，合并成一行 | `SELECT *`<br>`FROM t` → `SELECT * FROM t` |
| `Ctrl+Alt+Shift+7` | 删除所有 `&` 符号（顺带清理多余空格） | `apple & banana` → `apple banana` |
| `Ctrl+Alt+Shift+L` | 转成数据库 `IN` 列表（每行一个值） | `1001`<br>`1002`<br>→ `IN (`<br>`  '1001',`<br>`  '1002'`<br>`)` |

这三个操作**有选中内容就只处理选区，没有选中就处理整个文档**，并且进入撤销栈（`Ctrl+Z` 可回退）。
`Ctrl+Alt+Shift+L` 会剥掉原有的引号再重新加，单引号自动转义成 `''`，不会出现 `''123''` 这种错误。

### 编辑器能力
- 代码折叠（含折叠全部 / 展开全部）
- 括号配对着色 + 缩进参考线
- 多光标（Alt+点击，或 Ctrl+Alt+上下）
- 代码小地图（可关）
- 自动换行（可切）
- 当前行高亮
- 撤销 / 重做历史
- 单词补全建议
- 当前文件匹配项高亮（右侧概览条）
- 鼠标滚轮缩放（Ctrl+滚轮）
- 拖拽文件进窗口直接打开

### 文件处理
- 原子写入（先写临时文件再替换，避免写一半断电损坏）
- 外部修改冲突检测（保存时若磁盘文件已变，提示确认）
- 脏标记（内容改回原样会自动清除）
- 只读文件识别
- 二进制文件检测（不会把图片/压缩包当文本打开）
- 会话恢复（重启后恢复打开的标签、光标位置、文件夹）

---

## 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+O` | 打开文件 |
| `Ctrl+K` | 打开文件夹 |
| `Ctrl+N` | 新建文件 |
| `Ctrl+S` | 保存 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 切换标签 |
| `Ctrl+P` | 快速打开文件 |
| `Ctrl+F` | 当前文件查找 |
| `Ctrl+H` | 当前文件替换 |
| `Ctrl+Shift+F` | 整个文件夹搜索 |
| `Ctrl+G` | 跳转到行 |
| `Ctrl+B` | 显示 / 隐藏侧栏 |
| `Ctrl+,` | 设置 |
| `Alt+Z` | 软换行开关 |
| `Esc` | 关闭查找面板 / 菜单 |
| `Ctrl+Alt+Shift+D` | 删除换行 |
| `Ctrl+Alt+Shift+7` | 删除 `&` |
| `Ctrl+Alt+Shift+L` | 转 SQL `IN` 格式 |

---

## 目录结构

```
.
├─ src/                     前端（Vue 3 + TypeScript）
│  ├─ App.vue               主界面，工具栏 / 布局 / 快捷键
│  ├─ components/
│  │  ├─ EditorPane.vue     Monaco 封装（单实例 + model 切换）
│  │  ├─ FileTree.vue       文件树容器
│  │  ├─ TreeNodeRow.vue    递归树节点
│  │  ├─ TabBar.vue         多标签
│  │  ├─ FindPanel.vue      查找 / 替换面板
│  │  ├─ SearchPane.vue     跨文件搜索结果
│  │  ├─ QuickOpen.vue      Ctrl+P 快速打开
│  │  ├─ StatusBar.vue      状态栏
│  │  ├─ SettingsPanel.vue  设置（含系统字体选择）
│  │  └─ Icon.vue           内联 SVG 图标
│  ├─ lib/
│  │  ├─ api.ts             Tauri 命令封装 + 类型定义
│  │  ├─ store.ts           全局状态（标签 / model / 会话 / 草稿）
│  │  ├─ monaco-setup.ts    Monaco 主题 / worker / 语言注册
│  │  └─ textops.ts         文本转换（删换行 / 删 & / 转 SQL IN）
│  └─ styles/main.css       主题变量（浅色 / 深色）
├─ src-tauri/               Rust 后端
│  ├─ src/
│  │  ├─ lib.rs             命令注册 / panic 日志
│  │  ├─ encoding.rs        编码探测与转换
│  │  ├─ document.rs        文件读写（原子写）
│  │  ├─ fs_tree.rs         目录扫描
│  │  ├─ search.rs          并行搜索 / 批量替换
│  │  └─ config.rs          设置 / 会话 / 草稿 / 系统字体枚举
│  ├─ icons/                图标资源
│  └─ tauri.conf.json       Tauri 配置
├─ scripts/make-portable.mjs  便携版打包脚本
├─ .cargo/config.toml       mingw 工具链模板（需按自己环境改）
├─ build-portable.bat       Windows 一键构建
└─ dev.bat                  开发模式启动
```

---

## 从源码构建

### 依赖

| 组件 | 说明 |
|---|---|
| Node.js | 18+，用于前端构建 |
| Rust | 1.77+，`rustup` 安装 |
| C++ 工具链 | **二选一**：MSVC（VS Build Tools）或 MSYS2 mingw-w64 |

### 方式一：MSVC（Tauri 官方推荐，最省事）

```cmd
:: 安装 VS Build Tools（勾选 "Desktop development with C++"）
:: 然后：
npm install
npm run tauri:dev          :: 开发模式
npx tauri build            :: 生产构建
```

### 方式二：MSYS2 mingw-w64（无需管理员权限）

如果你不想装 3~6 GB 的 VS Build Tools：

1. 下载 [MSYS2](https://www.msys2.org/)，安装到任意目录
2. 在 MSYS2 终端执行：
   ```bash
   pacman -S --needed mingw-w64-x86_64-gcc mingw-w64-x86_64-binutils
   ```
3. 安装 gnu 宿主机工具链（关键，否则 build script 会去找 MSVC 的 link.exe）：
   ```bash
   rustup toolchain install stable-x86_64-pc-windows-gnu
   ```
4. 把 `.cargo/config.toml` 里的 `C:\msys64` 改成你的实际路径
5. 构建：
   ```cmd
   build-portable.bat
   ```
   或手动：
   ```bash
   export RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu
   npx tauri build --no-bundle --target x86_64-pc-windows-gnu
   node scripts/make-portable.mjs
   ```

产物在 `dist-portable/`。

### 开发模式

```cmd
dev.bat
```
或 `npm run tauri:dev`。前端跑在 `http://localhost:1430`，改动热重载。

---

## 单实例模式

同一时间只会运行一个进程，避免开一堆窗口找不清文件。

| 操作 | 行为 |
|---|---|
| 再次双击 `LeonEditor.exe` | 把已打开的窗口切到前台 |
| 资源管理器里「用 Leon Editor 打开」某文件 | 复用已有窗口，文件作为新标签打开 |
| 拖动文件到 exe 图标上 | 同上 |

需要同时开两个独立窗口（比如左右对照两份文件）时：

```cmd
LeonEditor.exe --new-instance
```

## 便携模式原理

程序启动时检查 exe 同目录是否存在 `portable.dat`：

| 存在 | 配置位置 |
|---|---|
| 是 | `<exe目录>\data\settings.json`、`session.json`、`drafts\` |
| 否 | `%APPDATA%\LeonEditor\` |

同一份 exe：放个 `portable.dat` 就是绿色版，删掉就是标准安装版。

## 未保存内容怎么保存的

不是把文本塞进 `session.json`（大文件会撑爆），而是分开放：

```
data/
├─ session.json        ← 元信息：哪些文件、光标、哪些草稿
└─ drafts/
   ├─ d1xxxx.txt       ← 草稿正文（原样文本）
   └─ d2yyyy.txt
```

- **每 20 秒**自动快照一次，窗口关闭时再存一次
- 只有 **dirty（有修改）** 的标签才写草稿，干净文件只记路径，重启时从磁盘重读
- 保存成功后立刻删除该标签的草稿；关闭标签（确认放弃修改）也删除
- 启动时 `prune_drafts` 清理没人引用的残留草稿
- 恢复时同一个路径**优先用草稿**，不会出现「磁盘版 + 修改版」两个标签

**注意**：如果程序被强杀（任务管理器结束进程），最多丢失最近 20 秒的修改。

---

## 已知限制

- 超大文件（数十 MB）目前是一次性读入内存并全部交给 Monaco。几万行无压力，但 50 MB 以上会明显变慢；后续可加流式只读大文件模式。
- 没有「另存为新编码」功能（目前是「以某编码重新载入」后再保存）。
- 暂无插件系统。
- 仅支持 Windows（代码层面未针对 macOS / Linux 做适配）。

---

## 贡献

欢迎提 Issue 和 PR。提交前请：

1. `npm run build` 确认前端能过
2. `cargo check` 确认 Rust 能过
3. 尽量保持提交信息清晰

---

## License

[Apache License 2.0](LICENSE)

---

## 致谢

- [Tauri](https://tauri.app/) — 轻量桌面应用框架
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — VS Code 的编辑器内核
- [Vue 3](https://vuejs.org/) — 前端框架
- [grep-searcher](https://github.com/BurntSushi/ripgrep) — 高性能搜索（来自 ripgrep）
- [encoding_rs](https://github.com/hsivonen/encoding_rs) — 编码探测与转换


