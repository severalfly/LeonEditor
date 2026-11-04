#!/usr/bin/env node
/**
 * 把 Tauri 构建产物整理成便携免安装目录。
 *
 * 产物结构：
 *   dist-portable/
 *     LeonEditor.exe        ← 主程序
 *     portable.dat          ← 存在即启用便携模式（配置写在同目录 data/）
 *     README.txt
 *
 * 用法：node scripts/make-portable.mjs
 */
import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const targetName = process.env.TAURI_TARGET || 'x86_64-pc-windows-gnu'
const exeNames = ['leon-editor.exe', 'LeonEditor.exe', 'leon_editor.exe']

const candidates = [
  join(root, 'src-tauri', 'target', targetName, 'release'),
  join(root, 'src-tauri', 'target', 'release'),
  join(root, 'src-tauri', 'target', 'x86_64-pc-windows-msvc', 'release')
]

let releaseDir = null
let exeName = null

for (const dir of candidates) {
  if (!existsSync(dir)) continue
  for (const name of exeNames) {
    const p = join(dir, name)
    if (existsSync(p) && statSync(p).isFile()) {
      releaseDir = dir
      exeName = name
      break
    }
  }
  if (exeName) break
}

if (!exeName) {
  console.error('[portable] 找不到编译产物。请先运行：npm run tauri:build')
  console.error('[portable] 已查找目录：')
  candidates.forEach((c) => console.error('  - ' + c))
  process.exit(1)
}

const outDir = join(root, 'dist-portable')
if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true })
}
mkdirSync(outDir, { recursive: true })

const srcExe = join(releaseDir, exeName)
const destExe = join(outDir, 'LeonEditor.exe')
copyFileSync(srcExe, destExe)

// mingw 目标下 WebView2Loader.dll 是外置的，必须一起复制，否则程序静默退出
const runtimeDlls = ['WebView2Loader.dll']
for (const dll of runtimeDlls) {
  const src = join(releaseDir, dll)
  if (existsSync(src)) {
    copyFileSync(src, join(outDir, dll))
    console.log(`  [portable] 已包含运行时依赖: ${dll}`)
  } else {
    console.warn(`  [portable] 警告: 未找到 ${dll}，程序可能无法启动`)
  }
}

// 便携标志文件
writeFileSync(join(outDir, 'portable.dat'), 'LeonEditor portable mode\n')

// 说明文件
writeFileSync(
  join(outDir, 'README.txt'),
  `Leon Editor - 便携版
================================

这个目录可以直接复制到任何地方（U 盘、移动硬盘、另一台电脑）使用。

【启动】
  双击 LeonEditor.exe

【为什么是便携版】
  同目录下的 portable.dat 是便携模式开关。只要这个文件存在，
  所有配置、会话记录都写在同目录的 data\\ 文件夹里，
  不会在系统里留下任何东西。

  删除 portable.dat 就变成标准模式（配置写到 %APPDATA%\\LeonEditor）。

【运行要求】
  Windows 10 / 11，需要 WebView2 运行时。
  Win11 自带；Win10 若未安装，程序会提示下载。

【主要快捷键】
  Ctrl+O            打开文件
  Ctrl+K            打开文件夹
  Ctrl+N            新建文件
  Ctrl+S / Ctrl+Shift+S   保存 / 另存为
  Ctrl+W            关闭当前标签
  Ctrl+Tab          切换标签
  Ctrl+P            快速打开文件（模糊搜索）
  Ctrl+F            当前文件查找
  Ctrl+H            当前文件替换
  Ctrl+Shift+F      整个文件夹搜索
  Ctrl+G            跳转到行
  Ctrl+B            显示/隐藏侧栏
  Ctrl+,            设置
  Alt+鼠标拖动       多光标

【文本处理（数据核对常用）】
  Ctrl+Alt+Shift+D  删除所有换行，合并为一行
  Ctrl+Alt+Shift+7  删除所有 & 符号
  Ctrl+Alt+Shift+L  转成数据库 IN (...) 格式，每行一个值

  以上三个快捷键：有选中内容只处理选区，没选中处理整个文档。
  转换后可 Ctrl+Z 撤销。

【未保存内容】
  程序每 20 秒自动保存一次「未保存的修改」快照，
  下次启动会自动恢复（包括从未保存过的新文件）。
  数据在 data\\drafts\\ 下。

【编码支持】
  自动识别 UTF-8 / UTF-8 BOM / UTF-16 / GBK / Big5，
  可在状态栏右下角手动切换「以编码重新载入」和换行符（LF/CRLF）。

【字体】
  设置里可直接从系统已安装字体中选择（自动列出等宽字体并排在前面）。

生成时间：${new Date().toLocaleString('zh-CN')}
版本目标：${targetName}
`
)

const sizeMB = (statSync(destExe).size / 1024 / 1024).toFixed(2)
console.log('')
console.log('  [portable] 便携版已生成')
console.log(`  目录: ${outDir}`)
console.log(`  主程序: LeonEditor.exe (${sizeMB} MB)`)
console.log('')
