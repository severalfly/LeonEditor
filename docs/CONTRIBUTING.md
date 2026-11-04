# 贡献指南

感谢你愿意为 Leon Editor 做贡献。

## 报告问题

提 Issue 前请先搜索是否已有相同问题。提交时请包含：

- Windows 版本（如 Windows 11 24H2）
- Leon Editor 版本（设置 → 关于）
- 复现步骤
- 期望结果 vs 实际结果
- 如果有崩溃，附上 `data\log\frontend.log` 和 `panic.log`

## 功能建议

欢迎提 Issue 描述使用场景。请说明「你要解决什么问题」而不是只描述「想要什么按钮」——
了解真实场景才能设计得更合适。

## 提交代码

### 环境准备

见 [README 的「从源码构建」章节](../README.md#从源码构建)。

### 流程

1. Fork 本仓库
2. 从 `main` 创建分支，命名建议 `feat/xxx`、`fix/xxx`
3. 提交前自测：
   ```bash
   npm run build      # 前端
   cargo check        # 后端
   ```
4. 提交 PR，说明改动内容和原因

### 代码风格

- **前端**：TypeScript，Vue 3 `<script setup>` 语法，2 空格缩进
- **后端**：`cargo fmt` 格式化，遵循 Rust 惯例
- 注释写「为什么这么做」，不写「这行做了什么」
- 中文注释可以，但变量名 / 函数名用英文

### 需要注意的架构约束

- **标签不要各建一个 Monaco 实例**，用「单实例 + 多 model」模式，参考 `src/lib/store.ts`
- **前端资源必须走相对路径**，`vite.config.ts` 里的 `base: './'` 不能去掉
- **构建必须用 `tauri build`**，不能用 `cargo build`（资源不会嵌入）
- 更多坑见 [docs/DEVELOPMENT.md](DEVELOPMENT.md)

## 提交信息

参考 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat: 支持正则跨行搜索
fix: 修复 GBK 文件另存后乱码
docs: 补充构建说明
refactor: 拆分 search 模块
```

## 许可证

你提交的代码将以 [Apache License 2.0](../LICENSE) 授权。
