# 搜搜记事本

小红书搜索记事本，Chrome MV3 扩展。带着目的搜，把有用的帖子、评论、截图贴进记事本，整理成板块，再按建议词继续搜。

**它不是聊天助手。** 没有对话框、不替你点网页、不生成完整攻略。人自己搜、自己决定收什么；插件负责把散落的材料收拢，并帮你下一轮搜得更准。

典型闭环：进站写下目的 → 搜索 → 收集 → 侧栏整理成分区 → 按建议词再搜。

## 产品是什么

- **主战场**：小红书（`www.xiaohongshu.com`）
- **形态**：Chrome 侧边栏记事本 + 页面内轻量收集控件
- **核心动作**：搜索 → 收集 → 整理板块 → 再搜
- **明确不是**：AI 聊天、答案生成器、替你把网页点完

仓库内部目录名仍可能是 `focus-guard`，对外名称以 `manifest.json` 里的「搜搜记事本」为准。

## 下载安装包

每个版本会在 GitHub Release 附带一个可直接给 Chrome 加载的 zip（解压后就是未打包扩展目录，含 `manifest.json`）。

- **最新安装包**：[Releases · 最新版](https://github.com/hotcatty/sousuo-jishiben/releases/latest)
- 当前版本 **1.31.0**：[`sousuo-jishiben-1.31.0.zip`](https://github.com/hotcatty/sousuo-jishiben/releases/download/v1.31.0/sousuo-jishiben-1.31.0.zip)

本仓库没有上架 Chrome 网上应用店，测试和试用都走上面的 zip。

本地从源码打包：

```bash
bash scripts/pack.sh
```

生成文件：`dist/sousuo-jishiben-<version>.zip`。

## Chrome 安装流程

1. 下载 zip，解压到一个你会留下来的目录（Chrome 会一直读这个文件夹，解压完不要删）。
2. 打开 Chrome，地址栏输入 `chrome://extensions` 回车。
3. 右上角打开 **开发者模式**。
4. 点 **加载已解压的扩展程序**，选中刚才解压出来的文件夹（能直接看到 `manifest.json` 的那一层）。
5. 打开 [小红书](https://www.xiaohongshu.com/)，点工具栏里的「搜搜记事本」图标打开侧栏。首次打开必须跟在一次用户点击后面。

也可以把 zip 解压后再按同样步骤加载那个文件夹。不要直接把 zip 拖进 `chrome://extensions`：未上架的扩展要用「加载已解压的扩展程序」。

侧栏走 Chrome Side Panel：点工具栏图标打开。

## 版本更新后怎么继续测

每次发新版本：

1. 从 [最新 Release](https://github.com/hotcatty/sousuo-jishiben/releases/latest) 下载新的 zip（或 `git pull` 后重新 `bash scripts/pack.sh`，也可以直接加载仓库根目录）。
2. 解压覆盖原来的文件夹；若解压到了新目录，在扩展卡片上移除旧扩展，再重新「加载已解压」。
3. 打开 `chrome://extensions`，找到「搜搜记事本」，点卡片上的 **刷新 / Reload**。
4. 再刷新小红书页面。只刷网页不够，扩展脚本不会自动换成新版本。
