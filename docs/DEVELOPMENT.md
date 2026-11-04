# 开发笔记 / Troubleshooting

记录搭建过程中踩过的坑，避免重复浪费时间。

## 1. 必须用 `tauri build`，不能用 `cargo build`

**最坑的一个。** 直接 `cargo build --release` 出来的 exe 只有 ~7 MB，前端资源根本没进去，
运行时表现为「窗口能打开，但一片空白、标签栏不渲染」。

原因：前端资源由 `tauri::generate_context!()` 宏在编译期嵌入，只有 `tauri build` 会正确
触发 build script 重新生成。`cargo build` 时如果 `dist/` 有变动，Cargo 不会感知。

→ **正确体积参考：约 9 MB。** 如果构建出来是 7 MB 左右，一定是资源没进去。

验证方法：

```bash
python -c "
d=open('LeonEditor.exe','rb').read()
for kw in [b'index-', b'monaco-', b'codicon']:
    print(kw, '->', d.count(kw), 'embedded')
"
```

三个都应该是 ≥1，否则资源没进去。

## 2. mingw 目标下 `WebView2Loader.dll` 是外置的

`x86_64-pc-windows-gnu` 目标不会静态链接 WebView2 加载器。缺这个 DLL 时程序**静默退出**，
没有任何报错窗口、没有日志，非常难查。

→ `scripts/make-portable.mjs` 已自动包含它，发布包里必须同时存在 `LeonEditor.exe` + `WebView2Loader.dll`。

## 3. Rust 工具链要用 gnu 版宿主机

只加 `--target x86_64-pc-windows-gnu` 不够，因为 **build script 和 proc-macro 始终为宿主机编译**，
宿主机是 msvc 就会去调 `link.exe` 然后失败（报 `link: extra operand` 之类莫名错误）。

→ 必须装 gnu 宿主机工具链：

```bash
rustup toolchain install stable-x86_64-pc-windows-gnu
```

构建时设 `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu`。

## 4. Vite 必须设 `base: './'`

Tauri 走自定义协议（`tauri://localhost`），绝对路径 `/assets/xxx.js` 会 404 导致白屏。
`vite.config.ts` 里已设置。

## 5. 便携版无控制台，排查靠文件日志

release 版是 `windows_subsystem = "windows"`，没有 stdout / stderr。所以内置了两个日志出口：

- `log/frontend.log` — 前端通过 `log_frontend` 命令写入（含启动自检）
- `panic.log` — Rust panic 钩子写入

排查问题先看这两个文件。

`log/frontend.log` 里的 `[render-check]` 一行包含：主题、工具栏高度、标签数量与名称、
Monaco 是否挂载、状态栏文本、字体枚举结果等。判断「界面有没有正常渲染」看这一行就够了。

## 6. 字体枚举踩坑

**不要用注册表读字体**（`reg.exe query ...\Fonts`）：一来依赖外部程序容易被安全策略拦，
二来拿到的名字带 `(TrueType)` 后缀还要清洗。

改用 GDI 的 `EnumFontFamiliesExW` 直接枚举，能拿到准确的字体家族名。

**等宽识别不能只看 `tm_ave_char_width == tm_max_char_width`**：这个条件对很多比例字体
也成立，实测 360 个字体里只识别出 1 个（还认错）。

**正确做法**：建一个该字体的 `HFONT`，用 `GetTextExtentPoint32W` 分别量
`iiiiiiiiii` 和 `MMMMMMMMMM` 的宽度，相等才是真等宽。为了不拖慢启动，
只对名字里含 `mono` / `consol` / `courier` 等关键词的字体做这个实测。

## 7. 快捷键 `Ctrl+Alt+Shift+数字` 的识别

浏览器/WebView 里这类组合的 `e.key` 会受键盘布局影响（比如 Shift+7 在某些布局下
`key` 是 `/` 而不是 `7`）。必须用 **`e.code`**（物理键位，如 `Digit7`）来判断。

## 8. 单实例 + 多 model 的标签架构

**不要每个标签建一个 Monaco 实例**。开 10 个标签就是 10 个编辑器，内存直接翻倍。

正确做法（VS Code 同款）：**一个 `IStandaloneCodeEditor`，每个文件一个 `ITextModel`**，
切换标签只是 `editor.setModel(model)`。50+ 标签依然轻量。

注意切换时要 `saveViewState()` / `restoreViewState()` 保住光标和滚动位置。

## 9. Windows 下原子写入

`std::fs::rename` 在 Windows 上目标文件已存在时会失败（Linux 不会）。
所以 `document.rs` 里是先 `remove_file` 再 `rename`，失败时清理临时文件。
