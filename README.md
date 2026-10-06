# 幼儿园计划工作台 · dsh-plugin-kinderplan

在 DSH 里维护一整套幼儿园学期计划：**月计划**和由它派生的**周计划**，保证两者永远对得上，
导出的 `.docx` 沿用园里现有模板（页边距、表框、页眉校徽、页脚「让教育回归自然」都来自模板本身）。

```
月计划（唯一数据源）            周计划（编译产物，不含课程数据）
┌──────────────┬────────┐      ┌─────────────────────────┐
│ 工作重点 ×3   │ 常规/德育/安全 │      │ 周工作重点 ×4 ← 月计划工作重点（精简）│
│ 课程内容      │ 第N周列 → 课题  │ ───▶ │ 集体教学活动 ← 月计划第N周那一列       │
│ 户外/离园/家园/区角 │         │      │ 晨间/散步/下午/室内 ← 词库 + 手工       │
└──────────────┴────────┘      └─────────────────────────┘
```

周计划**没有自己的课程字段**，这是「对得上」的结构性保证：改月计划就等于改周计划，不需要人工核对。

---

## 1. 安装

### 前置条件

| 条件 | 说明 |
|---|---|
| DSH | 已在运行（本说明以 `desktop` profile 为例） |
| Node | **>= 22**（`package.json` 的 `engines` 要求） |
| 无需外部服务 | 计划数据、词库、导出全部在本地；不连 ComfyUI，也不需要联网 |

### 一条命令装好

仓库自带 `install.ps1`，它做三件事，**都是幂等的**（重复跑不会重复加）：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

1. 往 `~/.dsh/profiles/desktop/package.json` 加一条 `link:` 依赖，并把这个包名写进 `dsh.profile.bundles`
2. 用 DSH 自带的 pnpm 在该 profile 里 `install`，建立 `node_modules` 软链
3. 往 profile 的 `cordis.patch.yml` 追加一条 `- id: dsh-plugin-kinderplan` / `disabled: false`
   —— **这一步是可选的**，见下面的说明
4. 校验软链是否就位，并打印当前 bundles 列表

改 profile 的 `package.json` / `cordis.patch.yml` 之前都会先备份成 `*.yyyyMMdd-HHmmss.bak`。

可选参数：

```powershell
.\install.ps1 -ProfileDir "$env:USERPROFILE\.dsh\profiles\其它profile"   # 装到别的 profile
.\install.ps1 -SkipInstall                                              # 只改配置，不跑 pnpm
```

### 手工装（两处必需改动）

profile 的 `package.json` 里加两样东西：

```jsonc
{
  "dependencies": {
    "dsh-plugin-kinderplan": "link:D:/plugins/dsh-plugin-kinderplan"
  },
  "dsh": { "profile": { "bundles": [ "...", "dsh-plugin-kinderplan" ] } }
}
```

然后装依赖（用 DSH 自带的 pnpm，避免版本不一致）：

```powershell
node "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" install --dir "$env:DSH_HOME\profiles\desktop"
```

> **profile 的 `cordis.patch.yml` 不是必需的改动。** 插件自带的 `cordis.patch.yml`
> 已经声明了自己的条目（`- insert: id: kinderplan`），并在 `package.json` 的
> `dsh.bundle.patch` 里注册过，DSH 会自动应用它——所以上面的 `install.ps1` 第 3 步只是
> 多给一个显式的 `disabled: false`，**不加也能用**。
>
> 要**禁用**这个插件时才必须走 profile 的 patch 层，而且按**包名**写，不是按板载条目的 id
> （板载 id 是 `kinderplan`，两者不同）：
>
> ```yaml
> - id: dsh-plugin-kinderplan
>   disabled: true
> ```

### 重启

**新增 bundle 必须重启 DSH 进程**才会生效，刷新页面不够。重启后侧边栏出现「幼儿园计划」图标。

### 装好之后怎么确认

| 检查 | 期望 |
|---|---|
| 侧边栏 | 出现「幼儿园计划」图标，点开是工作台面板 |
| 面板 | 能新建一个学期计划，并自动排出周次 |
| Agent 工具 | `kinder_plan` / `kinder_month` / `kinder_week` / `kinder_check` / `kinder_export` / `kinder_import` / `kinder_lexicon` / `kinder_draft` 可用 |

### 数据放在哪

数据与导出都在 DSH 主目录下（可整体备份）：

```
~/.dsh/kinderplan/
├── config.json       # 学期、放假安排、生成模型、导出目录
├── lexicon.json      # 常用句式词库（用户新增部分，内置短语始终在）
├── plans/<id>.json   # 每个学期一个 JSON，全部内容都在这里
└── exports/          # 没配导出目录时的落盘位置
```

导出 `.docx` 用的是随插件发布的 `templates/` 基础包，见下一节。

---

## 2. 模板事实（从你上传的文件里读出来的，不是猜的）

两份模板的版式、字体、行高都实测提取自 `大一班10月月计划.docx`、`大一班第十周周计划 (2).docx`、
`大一班第一周周计划.docx`，并作为**基础包**随插件一起发布（`templates/`）。
导出时只替换 `word/document.xml`，其余部件（styles、theme、fontTable、header1 的校徽、footer1 的绿字）原样带过。

| | 月计划 | 周计划（主版式） | 周计划（第一周版式） |
|---|---|---|---|
| 页面 | A4 纵向，页边距 622/1066/876/960 | A4 横向，浮动表格 `tblpX=990` | A4 纵向 |
| 表结构 | 18 行：月份 → 工作重点×3 → 课程内容（9 学科 × N 周）→ 户外/离园/家园/区角 | 10 行：周工作重点×4 → 内容/时间 → 集体教学 → 晨间/散步/下午/室内 | 14 行：周工作重点×5 → 上午 → 晨间/集体教学×2/户外 → 下午 → 自主/离园 |
| 列宽（twips） | 559 / 396 / 702 + 周列均分 9023 | 726 / 1261 / 822 / 2184 / 2603 / 2490 / 2524 / 2689 | 727 / 839 / 1786×4 / 1789 |
| 字体字号 | 标签 宋体 14pt 粗体，内容 12pt 粗体 | 标签 14pt，内容 宋体 12pt | 10.5pt |
| 行高 | 305 / 1564 / 1423 / 1379 / 660 / … / 3098 / 2751（`atLeast`） | 327 / 610 / 1105 / … / 901 | 991 / 1286 / … |

**为什么行高必须照抄**：这些是 `w:trHeight hRule="atLeast"`。删掉它们、只保留内容间距，
Word 会把每一行紧贴文字排版，月计划从 2 页涨到 3 页。实测过，所以照抄。

**为什么周计划的「工作重点」是精简版**：园里手写的周计划是提炼过的——10 月月计划「班级常规」一段四句，
对应的第八周周计划只留了一句。全文照搬不但读起来不对，还会把周计划表撑到第二页。
工作台默认只取前两点/前两句；「设置」页可以切成全文，也可以为某一周单独写覆盖文字。

---

## 3. 日历：整学期一次排到位

周次不是手填的，由开学日、结束日、放假安排推出来：

* 按**自然周（周一为一周之始）**分组。第六周 10.8-10.10 因此独立成周，不会和 9.28-9.30 并在一起。
* 一周的起止 = 该周**实际的上课日**，所以国庆后那周会短。
* **调休补课日**单独列（默认 `2026-10-10`）。没有它第六周会被悄悄缩成两天——
  你上传的第六周周计划表头写的是「星期四/星期五/星期六」，就是这个原因。
* 跨月的周按**多数上课日**归属：第十四周 11.30-12.4 是 1 个 11 月日 + 4 个 12 月日，归 12 月，
  和你现在的文件一致。
* 月次顺序跟学期走（9、10、11、12、1），不按月份数字排。

实测 2026-09-01 ~ 2027-01-22 排出 **21 个教学周**，与你已有的周计划完全吻合：

```
1:9.1-9.4  2:9.7-9.11  3:9.14-9.18  4:9.21-9.25  5:9.28-9.30
6:10.8-10.10  7:10.12-10.16  8:10.19-10.23  9:10.26-10.30
10:11.2-11.6 … 13:11.23-11.27  14:11.30-12.4 … 18:12.28-12.31
19:1.4-1.8  20:1.11-1.15  21:1.18-1.22
```

---

## 4. 一周的课怎么排到星期几

按月学科顺序取课题，每个学科有偏好工作日，冲突时顺延到最早的空格：

| 学科 | 偏好 | 实测 |
|---|---|---|
| 语言 | 星期一 | 第七/八周 ✓ |
| 数学 | 星期二（星期一被语言占了） | 第七周 ✓ |
| 音乐 / 美术 | 星期二 | 第八周音乐 ✓ |
| 科学 | 星期三 | 第八/九周 ✓ |
| 社会 | 星期四 | 第七/八/九周 ✓ |
| 安全 | 星期五 | 第七/八/九周 ✓ |

这套规则复现了你上传的每一份周计划的星期分布。一周超过 5 个课题时不会静默丢弃，
而是进「一致性」页报出来（例：1 月第十九周有 6 个课题，安全《小心楼梯》排不下）。

表头的星期名按**真实上课日**生成：第六周第一列是「星期四」，不是「星期一」。

---

## 5. 一致性检查

这是整个设计的目的。检查项：

| 级别 | 检查 |
|---|---|
| 错误 | 周次编号不连续 / 周次日期重叠 / 某周不在任何月计划里 |
| 错误 | **导入的旧周计划与月计划错位**：课题挪了周、学科标错、漏排 |
| 警告 | 一周课题超过 5 格排不下 / 某周在月计划里没有课题 / 工作重点为空 |
| 警告 | 同一课题在一个月内重复 / 月计划工作重点或长文本缺失 |
| 提示 | 主题名称为空 / 同一课题跨周重复 / 排课星期与模板规则不同 |

**它在你自己的文件上抓到了真问题**（导入 4 份月计划 + 5 份周计划后）：

```
[错误] 第6周  把《该怎么办》写成「科学活动」，但月计划把它归在「社会活动」
[警告] 第10周 导入的周计划里「语言活动：」没有写课题名称（月计划有《认识长方形》）
[警告] 第16周 12月份里「《神奇的树》」重复出现：语言 和 艺术/音乐 同一周
[警告] 第19周 一周 6 个课题，只有 5 个工作日格：安全《小心楼梯》排不下
[提示] 第15周 《水》在第13周已经出现过
```

第一、二条正是手写计划最容易出的错，也是「周计划和月计划对不上」的典型形态。

---

## 6. 用法

### 界面（侧边栏「幼儿园计划」）

| 页 | 内容 |
|---|---|
| **月计划** | 直接编辑月计划表——就是导出 Word 的那张表。左侧切月份，右侧点格子改。改这里等于同时改这个月的 4 份周计划。下方可让 AI 起草本月。 |
| **周计划** | 选周次，看到编译结果：四条工作重点（带「取月计划」按钮）、星期表头、**只读的集体教学活动**（悬停显示来自月计划第几周哪一列）、晨间/散步/下午/室内。可改主题、覆盖工作重点、改游戏；一键下载 Word。 |
| **一致性** | 三级清单，每条带周次、说明、修改建议；点条目直接跳到那一周/那个月。可切成 Markdown。 |
| **词库** | 12 个分类，内置短语＋导入时自动学会的句式。点一条即复制。 |
| **导入** | 一次选整个学期的 `.docx`，自动识别月计划/周计划并归档。 |
| **设置** | 生成模型、学期与放假安排、调休日、周计划取全文/精简、数据位置。 |

### 对话（Agent 工具）

| 工具 | 作用 |
|---|---|
| `kinder_plan` | 建/列/查/改/删计划，重算日历 |
| `kinder_month` | 读或写某月工作重点、九学科逐周课题、四段长文本 |
| `kinder_week` | 读某周编译结果；写该周的主题、工作重点覆盖、游戏 |
| `kinder_check` | 一致性报告（可要 Markdown） |
| `kinder_lexicon` | 词库列出/搜索/新增/删除 |
| `kinder_import` | 按路径导入 docx |
| `kinder_draft` | AI 起草月/周计划，确认后再写入 |
| `kinder_export` | 导出单个 Word 或整学期打包 |

直接说就行：

> 用 kinder_import 把桌面上的大一班 10~1 月月计划和第六到二十周周计划导进来，然后 kinder_check 看看哪里对不上。

> 10 月第七周的语言课改成《秋天的雨》，改完顺便重排一下那周的星期。

### 导出

「导出整学期 Word」会在桌面建一个文件夹，写入：

```
<学期><班级>计划/
├── <园所><班级>10月份月计划.docx      × 每个月
├── <园所><班级>第六周周计划.docx        × 每个教学周
├── 一致性检查报告.md
└── 计划数据.json
```

---

## 7. 实现要点

* **零依赖**。DSH 里没有 zip/docx 库，所以 `lib/zip.js` 用 `node:zlib` 实现了 OOXML 需要的
  ZIP 读写子集（CRC32、deflate/store、中央目录），`lib/docx.js` 生成 `document.xml`，
  `lib/docx-read.js` 用线性扫描解析表格（Word 表格是扁平的 `w:tr`/`w:tc`，不需要完整 XML 解析器）。
* **模板即基础包**。导出 = 复制模板 zip → 替换 `word/document.xml` → 改 `docProps/core.xml`。
  `sectPr`（页面/页边距/页眉页脚关系）和 `tblPr`（边框/表样式/浮动位置/单元格边距）是从模板里
  原样抠出来重新拼进去的。
* **AI 只写文字**。模型不决定版式、不决定课题归属，所以一次 AI 起草不可能把月计划和周计划弄得不一致。
  生成结果先返回给人看，确认后才写入。
* **长任务进运行队列**。「导出整学期」（~28 个文件）和 AI 起草都起一个可轮询的运行，
  工具等一小段就返回 run id，不把一个回合卡在一次模型调用上。
* **中文文件名下载**走 RFC 5987（`filename*=UTF-8''…`），并用查询串令牌，因为浏览器的
  导航下载带不了请求头。

## 8. 自测

仓库内的验证脚本（`../.verify/`）。八个套件全绿，共 159 条断言：

| 脚本 | 覆盖 |
|---|---|
| `smoke.mjs` | 导入真实月计划 → 重排日历 → 回写 docx → 再读回来，逐一比对 9 个学科列 |
| `api-test.mjs` | 建计划、导入 9 个文件、一致性报告、渲染、整学期导出、词库学习、改月计划影响周计划、改学期自动重排、8 个工具 |
| `host-test.mjs` | 宿主 `apply()`、路由注册、令牌门禁（无令牌/错令牌 403）、导入、报告、词库增删改查、docx 下载（含 RFC 5987 文件名与查询串令牌）、整学期导出运行、错误路径 —— 39 条断言 |
| `client-test.mjs` | 用桩 React 把每个界面组件拿真实数据渲染一遍 |
| `client-static-test.mjs` | 源码级检查：`useEffect` 之外看不出来的东西 —— CSS 花括号/括号配平、每个 `kp-` 类都有定义、每个官方设计令牌都带 fallback、`__test__` 是非枚举的（避免加载器校验 `Object.keys()` 时多出一个键）、工厂只 `require('react')`、不含 ESM 语法 |
| `ui-flow-test.mjs` | 桩 React **真的执行 `useEffect`**，`fetch` 打到插件自己的路由处理器上：挂载引导 → 切页签 → 选月份/周次 → 改课程格 → 保存（核对写进存储）→ 整学期导出（核对落盘）—— 37 条断言 |
| `week1-test.mjs` | 竖版 14 行表（第一周版式）：行数、列数、合并结构、两个「集体教学活动」行的 restart/continue 与原件逐格对照 |
| `resolution-test.mjs` | 重启前最后一关：从 profile 目录按裸包名解析、`exports` 子路径、`dsh.bundle.patch` / `dsh.client` 声明、patch 只 insert 不覆盖、宿主与客户端两半都能加载 —— 35 条断言 |
| `isolation-test.mjs` | 回归测试「一个工具注册失败把整个插件带崩」：模拟宿主拒绝全部 / 单个工具定义，断言 Web 路由与启动令牌照旧注册、`/status` 仍返回 200、失败清单被记录 —— 19 条断言 |
| `tools-contract-test.mjs` | 把 8 个工具定义喂给**从 app.asar 里抠出来的宿主真校验器**（`assertSupportedJsonSchema` / `validateJsonSchemaValue`）：逐条核对 `output.schema` 在支持子集内、真实 `execute()` 的返回满足 `output.schema`、`output.render` 返回内容块 —— 76 条断言 |

```powershell
foreach ($s in 'smoke','api-test','host-test','client-test','client-static-test','week1-test','ui-flow-test','resolution-test','isolation-test','tools-contract-test') {
  node ".verify/$s.mjs"
}
```

> `tools-contract-test.mjs` 先用 `.verify/asar.cjs out` 把 `@deepseek-ai/dsh-tools` 的
> `lib/index.js`、`lib/types/{index,json-schema}.js` 和 `@deepseek-ai/dsh-util-values`
> 抠到 `.verify/dsh-tools/`，再补一个只导出 `HarnessError` 的 `@deepseek-ai/dsh-llm` 桩
> （`json-schema.js` 只拿它当基类）。抠不到就明确报「validator unavailable」，不会假装通过。

> 桩 React 的两个坑，都踩过：`useCallback` 必须像真 React 一样在依赖不变时返回同一个函数，
> 否则每个 `useEffect(..., [cb])` 都会无限重跑；`setImmediate` 也不足以等宿主侧的
> 文件 I/O，排空循环要看「还在不在推进」。另外表单控件的文本在 `props.value` 里而不是
> children 里，只遍历 children 会把整张课程表看成空的。

## 9. 已知限制

* 周计划「集体教学活动」一天一格。一周超过 5 个课题时会在一致性页报出来，需要人工挪周或合并。
* 「手指律动」「健康」在月计划里有行、周计划主版式里没有对应格，填了不会出现在周计划上。
* 页眉校徽是**你上传模板里的那张图**。换园所请替换 `templates/*.docx` 的 `word/media/image1.jpeg`
  （或直接替换整个 `templates/` 下的基础包）。
* 放假安排默认只带 2026 秋季的国庆与元旦；中秋默认关闭（你现有的第四周文件我这边没有，
  打开它会让第四周提前一天结束）。请在「设置」页按实际校历核对。

## 10. 排查：面板能打开，但按钮没反应

这是最容易被误认为「按钮坏了」的一种故障。客户端 bundle 由 Harness 独立下发，**宿主半边
加载失败时面板照样能显示**，只是没有后端、没有启动令牌，于是每个按钮都静默无效。

先看这个文件，它每次加载都会同步重写：

```
~/.dsh/kinderplan/last-load.json
```

| 内容 | 含义 |
|---|---|
| `"ok": true`，`tools.failures` 为空 | 一切正常 |
| `"ok": true`，`tools.failures` 非空 | 插件活着，只有列出的对话工具没注册。界面不受影响，把 `failures` 发我即可 |
| `"stage": "failed-at-web-ui"` / `"failed-at-provide"` / `"failed-at-tools"` | 插件在这里崩了，`error.message` 与 `error.stack` 是现场 |

`stage` 的取值顺序是 `start → provide → web-ui → tools → runs → done`。写入是同步的，
所以即使进程在处理过程中被杀，文件里也留着最后到达的阶段。

界面上也会显示：令牌缺失时面板顶部有一条红条（带「刷新页面」按钮）；`tools.failures`
非空时「设置」页会多出一张「对话工具注册失败」卡片。

**故障历史**：最初 `apply()` 先注册对话工具、再注册 Web 半边，于是踩了两个坑叠在一起：

1. **工具定义形状不对**。本版宿主要求 `definition.output = { schema, render }`，
   而旧写法把 `render` 放在顶层。`tools.register()` 直接抛
   `tool "kinder_plan" must declare output { schema, render, presentationMeta? }`。
   支持的关键字只有 `type / oneOf / properties / required / additionalProperties /
   items / enum / const` 加 `description / title / default / examples`；而且 `output.schema`
   会用来校验 `execute()` 的返回值，**写太紧会把能用的工具变成硬报错**，所以用的是
   `{ type: 'object', required: ['ok'], additionalProperties: true }`。
2. **一个工具失败带崩整个插件**。上面那条异常从 `apply()` 抛出，拥有 Web 路由的子插件
   根本没轮到执行 → 路由 404、页面没有令牌、所有按钮静默无效。

现在 Web 半边排在最前、每个工具各自隔离，并且 `tools-contract-test.mjs` 用宿主自己的
校验器把 8 个定义钉死。`last-load.json` 的 `tools.registered` 可直接确认是否全部注册。
