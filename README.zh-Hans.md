Windows 开发：请阅读 [DEVELOPMENT.md](DEVELOPMENT.md)。下文使用相对输出路径的示例应在 DevCache 工作区运行；现有输出快照是保留的验证记录。

# maimai.party · 谱面浏览器

[English](README.md) · [简体中文](README.zh-Hans.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

本地化维护：[界面文案、游戏术语与多语言搜索数据重建](docs/LOCALIZATION.md)。

本项目包含独立的静态谱面浏览器、可复用的 Python 分析引擎，以及只读的 Kamaitachi 下载工具。个人推荐在下载或导出时计算；搜索、筛选、Flow 和谱面结构比较均可交互操作。

[持久化官方曲库](docs/REGISTRY_IMPLEMENTATION.md)将已知乐曲和谱面类型与可选的谱面转录及分析数据分开管理。经过审核的日本版和国际版数据快照包含仅有元数据的谱面，保留旧链接，并维持 Session Report 现有的集成接口约定。

[由维护者运行的曲库更新流程](docs/CATALOG_UPDATES.md)统一准备来源更新、缓存分析、元数据及精确的 mai-notes 播放器链接，并生成变更报告、验证发布结果。可播放的匹配项会以 **mai-notes simai player** 显示在 YouTube 旁，指向所选难度的谱面。

需要 Python 3.11+。软件包没有运行时依赖，也不需要报告库。在本地检出的仓库中使用 `python -m pip install .` 安装。

公开浏览器也可以显示您的个人达成率和已保留的谱面历史。可在设置中导入玩家文件，或接收 Session Report 传入的数据。数据保留在您的浏览器中；是否保存到设备由您选择。折叠个人筛选条件不会清除当前选择。每张有记录的谱面会显示彩色评级字母、紧凑的连击／同步图标，以及低调的**您**标签。玩家身份、数据采集范围和存储选项都在设置中。展开谱面后，测量值和配置归在**谱面详情**下，其后是**您的数据**及已保留的历史。这两组内容会在切换乐曲和再次访问时记住展开状态。比较和查找相似谱面仍位于主卡片上、版本图案旁。
详见[个人数据、精确链接与公开匹配接口](docs/PLAYER_DATA.md)。

## 预览

```sh
maimai-chart demo --output output/site
python -m http.server 8765 --bind 127.0.0.1 --directory output/site
```

打开 `http://127.0.0.1:8765`。内置演示使用虚构数据，不代表游戏曲库的收录范围。使用经过审核的真实元数据构建时，请运行 `maimai-chart site --catalog catalog.json --catalog-version RELEASE --output output/site`。曲库版本不可变；重复构建会保留旧版本及其链接。将生成的目录连同清单和资源文件一起作为静态文件提供即可，无需账户服务、上传接口或应用服务器。[公开发布计划](docs/PUBLIC_RELEASE.md)安排在当前配置检测目标完成后，涵盖源码公开、maimai.party 托管、社区贡献，以及仅由维护者发布官方语料库的流程。参见[贡献指南](CONTRIBUTING.md)。

两个浏览器页面都使用 maimai.party 字标，`.party` 部分采用 Deluxe 风格配色。启用 Stripe 时，关于页面会并排显示**在 GitHub 查看**和**赞助 maimai.party**。页脚保留独立爱好者项目的权利声明及**鸣谢**。参见[署名与来源用途](THIRD_PARTY_NOTICES.md)。项目仓库公开，通过 issue 和 pull request 接收贡献。正式站点发布必须由维护者明确执行，流程见[维护者指南](docs/OWNER_PUBLICATION.md)。

正式发布的 HTTPS 站点可选用 Google Analytics 统计概括性的页面访问。只有访问者同意后才会加载，本地预览不启用。个人文件、搜索内容、所选谱面和完整 URL 都不会成为分析事件数据。页脚提供隐私说明和撤回同意的方式，撤回时无需清除个人成绩。参见[分析功能设置与上线验证](docs/ANALYTICS.md)。

若要在 Explore 之外同时提供完整的研究用浏览器，请在 demo 或 site 命令中添加 `--lab-package PATH/TO/challenge-v1`。构建会验证固定的研究数据包，并通过不可变的发布清单引用独立的数据文件。主页链接到研究用浏览器，其包含三个视图：

- **谱面：**组合使用分类、版本、难度、谱面类型和等级范围筛选，可同时选择多个版本。每个乐曲／类型行都有难度选择器，只列出符合筛选条件的具体谱面，包括等级相同的 MASTER/RE:MASTER 谱面。当前难度决定行的颜色、等级、来源 BPM、输入速率及比较操作。点击行内其他位置可展开详情。点击列标题可排序或反转顺序；按住 Shift 点击，或启用**保留排序优先级**，可添加同值时的次级排序条件。已显示的优先级标签可用于删除规则。排序始终以所选谱面为准。**难度**按显示等级（10、10+、11）排序；**定数**按保留的小数定数排序。无论升序还是降序，未知值都排在最后。更改排序或搜索不会清除筛选条件。
  乐曲搜索也支持社区使用的罗马字和别名：**Umiyuri** 可找到 **ウミユリ海底譚**，**Senbonzakura** 可找到 **千本桜**。空格、标点、大小写和全角拉丁字母均可兼容。这些别名同样适用于 Explore 和两个比较选择器；显示的仍是原曲名。参见[别名覆盖范围与来源](docs/SONG_SEARCH.md)。来源中的乐曲 BPM 是展示用元数据，具体段落可能变速。未知 BPM 保持未知，无论排序方向如何都排在最后。
  **YouTube 搜索**会使用曲名、谱面类型和所选难度打开新标签页。比较选择和相似结果中也提供相同链接。这些是搜索链接，并非经过验证的视频匹配，不保证视频可用。在访问者点击链接之前，不会加载 YouTube 视频、缩略图或发出相关请求。曲名为空的条目不提供搜索链接。
  已准备的实验性配置标签可链接到教学条目，配置筛选只保留匹配的难度。详情显示观测到的次数和谱面时间区间。每行都有分为 24 段的 Flow 图，展示平均密度和短时峰值标记。迷你图按各自峰值缩放；比较图共用同一纵轴刻度。
- **谱面配置词典：**56 个按字母顺序排列的教学条目，附有编写的示例和说明。所有演示都支持播放、逐步前进、速度与进度控制，包括 0.1×、0.25×、0.5× 和 1× 播放速度。对照案例、变体及适用限制保留在教学数据中。图示和播放时，同时输入以金色显示。输入配置提供时序和位置视图；谱面特征使用活动图或高亮片段。当前事件说明会解释每一步。Umiyuri 条目结合来源资料，展示一种反复出现的形态，并明确其适用范围。教学示例不会给实际谱面贴标签，也不能用于验证检测器。英文别名包括 jacks、sweeps、spins 和 connected slides。新增的十种社区配置和十种相关结构形态配有英文教学说明、必要的示意曲线，以及有明确适用范围的实验性识别规则。参见[社区配置参考与覆盖范围](docs/patterns/COMMUNITY_PATTERNS.md)和[词典检查清单与待审核项目](docs/PATTERN_DICTIONARY.md)。
- **比较谱面：**通过可搜索的选择器选择任意两张谱面，或先选一张，再在曲库中**查找相似谱面**。比较使用已有的输入速度、节奏、同时输入、HOLD、SLIDE 和布局测量值。相似结果在每个乐曲分组中只显示一张谱面，并可选择套用当前谱面筛选条件。链接保留两张谱面的 ID 和曲库版本。共有及不同的配置、出现次数／频率以及并排的 Flow 图会显示在测量表之前。**配置与测量值**模式优先考虑实验性配置是否出现、出现频率和覆盖时间（合计占 60%），测量得到的操作需求占 40%。较少见的配置权重更高；不支持的检测范围绝不视为“未出现”。**测量值**模式保留原有排名方式。这些属于实验性比较，并非经验证的社区谱面分组，也不是个人推荐。预先准备的谱面对仍可播放同步片段动画，原有示例位于**预设片段演示**下。

界面沿用报告站点的白色／青绿色风格。词典链接保留研究曲库版本和配置 ID。研究数据不包含在 Python 发行包或源码仓库中，也不能接收个人成绩。

从已保留的输入数据准备研究用配置／Flow 扩展：

```sh
python scripts/build_research_overview.py RETAINED_SOURCE EXISTING_PACKAGE NEW_PACKAGE
maimai-chart demo --output output/site --lab-package NEW_PACKAGE
```

此离线命令对每张具体谱面运行现有的 14 个实验性检测器和 Flow 计算，并保留来源哈希。它会写入可续算的缓存，仅在所有谱面处理完成后才发布新的数据包清单。原数据包、排名、存档和个人服务均保持不变。浏览器构建会新增一个不可变版本；旧链接仍使用先前的数据。

## 下载并准备个人成绩

```sh
maimai-chart download USERNAME --game maimaidx --store .snapshots/player
maimai-chart prepare --snapshot .snapshots/player/captures/SNAPSHOT_ID/snapshot.json --catalog catalog.json --catalog-version RELEASE --mapping reviewed-mapping.json --output output/my-results.json
```

下载工具只读取 Kamaitachi 已有的个人最佳成绩（PB）和近期成绩，绝不会触发游戏数据导入。若访问需要令牌，请通过进程环境变量提供 `KAMAITACHI_API_TOKEN`；令牌不会写入快照或浏览器文件。工具不会自动重试，也不会安排定时请求。

若要用一条命令完成下载和准备，请将四个准备选项添加到 `download`。可选的 `--settings settings.json` 用于选择现有的推荐策略、练习目标和配额。更改目标后需要重新准备文件。通过**打开我的成绩**载入生成的文件，数据只保存在当前标签页内存中；**清除我的成绩**或重新加载页面即可移除。任何个人数据都不会上传。

每个存储目录只属于一名玩家的一款游戏。清单记录成功保存的不可变快照及最新身份信息。每个快照包含 `pbs.json`、`recent.json` 和 `snapshot.json`。可获取的游玩记录按精确的成绩 ID 累积，但历史仍不完整：轮询近期成绩无法还原所有过去的游玩。中断的采集不会替换指向最近一次成功快照的指针。手动删除过期锁之前，必须确认没有写入进程正在运行。

## 集成

Python 接口：`maimai_analyzer.catalog.build_catalog`、`maimai_intelligence.snapshots.download_snapshot`、`maimai_intelligence.bundles.prepare_player_bundle` 和 `export_report_bundle`。对于公开摘要匹配，`maimai_analyzer.challenge_similarity.query_demands` 接受已有谱面特征和参考尺度，无需提供片段时间窗口。浏览器使用等价的百分位和距离计算。参见[版本化接口约定](docs/CONTRACTS.md)和[报告集成](docs/REPORT_INTEGRATION.md)。

普通报告安装不需要此仓库或分析引擎。预先准备的卡片及指向具体曲库的链接属于可选报告功能。现有存档无需迁移或补录历史数据。

当前的谱面转录研究属于评估数据，不含个人信息，也不能用于已验证的 Rating 推荐。个人数据包需要经过明确审核的、从数据提供方到曲库的精确映射，以及经验证适用于该用途的曲库。未知达成率、缺失游玩记录和未确认的可用性仍保持未知。

## 开发

设置 `PYTHONPATH=src`（同时将仓库根目录加入导入路径），运行 `python -m unittest discover -s tests`。浏览器测试位于 `tests/browser`；使用 `npm ci` 安装锁定版本的依赖，安装 Playwright 浏览器后运行 `npm test`。构建后端支持 wheel 和源码发行包，无需下载构建依赖。原有分析器以及验证 Python/JavaScript 相似度计算一致性的测试数据均予以保留。

现有研究数据采集／构建脚本和 Challenge Lab 渲染器单独保留，仍须明确运行离线／研究流程；打开主浏览器不会执行它们。署名信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 谱面筛选

难度使用复选菜单，可任意组合 BASIC 至 RE:MASTER。每行保留用于切换当前显示难度的选择器，仅包含符合条件的难度。等级范围提供两个可拖动且可用键盘操作的滑块，以及可编辑的起始／结束字段。按 Enter 或移开输入焦点即可应用；`13.5` 可作为 `13+` 输入。上下界以所选曲库实际存在的等级为准。无效文本不会改变已应用的范围；若输入的边界超过另一端，则两端都移动到该等级。清空字段可将该端恢复为完整范围的端点。重置等级不会影响其他筛选条件。比较时启用“使用谱面筛选条件匹配”，也会采用相同的难度和等级范围限制。

配置使用可搜索的复选菜单；搜索包含别名，结果只需匹配任一所选配置。已选配置显示为可删除的标签，通过可重复的 `pattern-filter` URL 参数保存和恢复；原有单配置链接及词典查找仍然有效。不支持检测的配置显示为禁用状态。

## 可选的公开图像资源

曲绘和版本标志只需准备一次，之后即可提供生成的本地 WebP 文件。准备过程需要 Pillow（`python -m pip install Pillow`）；浏览或构建已经准备好的数据包仍使用通常的无依赖安装方式。

```sh
python -m scripts.prepare_public_artwork output/challenge-patterns-v1 output/challenge-artwork-v1 --cache output/artwork-cache/downloads
maimai-chart demo --output output/site --lab-package output/challenge-artwork-v1
```

命令只读取公开元数据和图像。`--offline` 可在不访问网络的情况下复用缓存。缺失图像会显示中性占位图。曲绘匹配要求规范化后的曲名**和艺术家**唯一匹配；此展示用查找不会建立谱面身份，也不会启用个性化功能。数据包记录来源 URL、来源哈希和转换后图像哈希。浏览器只加载本站资源，不涉及账户信息、远程图像请求或第三方脚本。

保留的来源已包含 CiRCLE（78 个乐曲／类型条目、315 张谱面）和 CiRCLE PLUS（18 个条目、75 张谱面）。2026-09-11 检查了上游默认分支：提交 `e164add85213bab150e1487d5eb15ccb631aedb9` 仍与保留的文件树一致，没有新增或更改路径。上游最新发布为 [v1.66_1.0.9.0](https://github.com/Neskol/Maichart-Converts/releases/tag/v1.66_1.0.9.0)，即 CiRCLE PLUS 首发更新；这描述的是来源数据覆盖范围，并不代表完整的当前游戏曲库。版本选择器会显示各版本实际的乐曲和谱面数量。
