# 导入玩家数据

打开**导入玩家数据**，展开你使用的服务。按下方步骤操作，并在导入前检查玩家、区域、个人最佳成绩（PB）、未匹配谱面和被排除的记录。选择记住会将数据保存在此设备上；仅导入一次则只在当前标签页中保留。

<a id="direct-connections"></a>

## 连接与刷新

Diving-Fish 或 LXNS 连接可用时，通过账号授权读取成绩。玩家无需注册开发者应用。请只在所选服务的网站登录，Party 不会要求提供其密码。Party 的连接服务会保存加密的访问授权和账号标签，以便刷新；成绩保存在你的浏览器中。断开连接会移除 Party 保存的授权；对于水鱼，也可以在[其已授权应用](https://auth.diving-fish.com/apps)中撤销访问权限。LXNS 的操作见下方专属章节。Maishift 和 Kamaitachi 通过公开接口查询，无需账号授权。

**刷新只会读取成绩记录服务中已有的数据，不会从 SEGA、Wahlap 或 maimai NET 获取新成绩。** 请先更新该服务的数据。刷新日期不是游玩日期。读取失败时，已保存的成绩会保留。如果无法检查连接是否可用，请稍后重试；这并不表示运营者已禁用该连接。

<a id="session-report"></a>

## Session Report / Party 玩家文件

1. 在 Party 中展开 Session Report，选择文件导入方式。选择先前从 Session Report 或 Party 下载的压缩玩家数据文件（.gz）。
2. 对于托管报告，选择报告网址导入方式并粘贴网址。明确公开的报告必须允许浏览器访问。对于私人报告，请在报告网站登录后选择 **Open in Party**，或下载其玩家文件；私人报告需要通过这种辅助方式刷新。
3. 检查玩家资料，然后选择仅导入一次或记住。

Session Report 根据 Kamaitachi 数据和保留的历史记录生成文件。这些文件不是 Kamaitachi 原生账号备份。

<a id="maishift"></a>

## Maishift

1. 按照 [Maishift 指南](https://maimai.shiftpsh.com/en/guide)更新成绩。在相应网站完成 NET 登录和书签脚本操作。
2. 在 Party 中展开 Maishift，输入公开用户名或资料网址。玩家无需提供密码，也无需进行开发者设置。
3. 读取资料，检查区域和 PB 预览，然后导入。

日本版与国际版记录保持独立。含有 `@jp`、`@intl` 或 `@na` 的网址会选择对应的记录；北美使用国际版记录，但可用谱面不同。仅输入用户名时，Party 会先请求国际版，并使用 Maishift 返回的区域。若两者都有，请粘贴含 `@jp` 的网址以选择日本版。界面语言不会决定区域，记住后的刷新也会保持所选区域。

此方式导入已游玩谱面的 PB，而非游玩历史。目前不支持导入 Maishift 原生备份文件。已有的 Session Report/Party 玩家文件请使用上方的独立服务选项。

<a id="kamaitachi"></a>

## Kamaitachi

1. 使用已有成绩的 Kamaitachi maimai DX 资料。如果缺少新成绩，请先通过其[导入页面](https://kamai.tachi.ac/import)更新 Kamaitachi。Party 不会创建 Kamaitachi 账号，也不会上传机台成绩。
2. 在 Party 中展开 Kamaitachi。输入用户名、数字用户 ID 或标准资料网址，例如 `https://kamai.tachi.ac/u/username`。
3. 仔细检查解析出的玩家和 PB 预览：公开查询不会验证账号是否属于你。选择仅导入一次，或记住资料以便以后刷新。

Party 使用 Kamaitachi 的公开 API，无需密码或 API 密钥。此方式导入已有的 maimai DX PB，包括 STD 和 DX 谱面；不包含独立的旧版 maimai 游戏或全部游玩历史。数字账号 ID 可避免账号改名后与其他玩家混淆。旧版 Session Report 中按用户名标识的玩家仍保持独立。

如果找到了玩家，但没有 maimai DX 成绩，请先将成绩导入 Kamaitachi，再重试。Party 的刷新只读取 Kamaitachi 已有的数据。读取时间不是最近的游玩时间或上游同步时间。

如需导入交换文件，请在 Kamaitachi 中选择**上传 BATCH-MANUAL**。请先查看[文件格式限制](#tachi)；这不是 Kamaitachi 原生账号备份。

<a id="diving-fish"></a>

## Diving-Fish / 水鱼查分器

此连接导入水鱼中已有的**舞萌 DX 国服**成绩。水鱼目前的登录界面、个人资料设置和使用指南为中文。

1. 打开[水鱼查分器](https://maimai.diving-fish.com/)，登录并同意查分器用户协议，确认可以看到自己的成绩。
2. 如果尚未使用水鱼，请先注册，按提示完成邮箱验证，再按照[成绩导入指南](https://maimai.diving-fish.com/manual/docs/category/%E5%AF%BC%E5%85%A5%E6%88%90%E7%BB%A9/)操作。注册账号不会自动添加机台成绩。请先将成绩导入水鱼，再返回 Party。
3. 在水鱼的**编辑个人资料**中关闭**对非网页查询的成绩使用掩码**，以获取精确成绩。Party 无法验证此设置。可以保持**禁止公开接口使用我的成绩（授权不受影响）**开启：公开查询隐私设置不会阻止此次授权连接。
4. 在 Party 中展开 Diving-Fish，勾选**我的成绩已更新。**和**成绩掩码已关闭。**后连接；步骤旁的 **?** 可查看说明。在 `auth.diving-fish.com` 登录并批准读取个人资料和成绩的权限。
5. 返回 Party，检查解析出的玩家、PB 数量和未匹配谱面，然后选择仅导入一次或记住连接。

如果水鱼中没有成绩，请先更新水鱼。如果 Party 提示需要同意查分器用户协议，请打开水鱼、同意协议并检查成绩。已记住的连接随后可重试刷新。首次导入失败时，尚未确认的连接会被清除；完成设置后请重新连接。

刷新只读取水鱼已有的 PB，不会将新机台成绩导入水鱼，也不会生成游玩历史。读取时间表示 Party 何时读取了水鱼，而非最近游玩时间。读取失败或结果为空时，已保存的数据会保留；本次未返回的 PB 也不会被删除。未匹配谱面会保留，不会猜测其对应关系。

如需停止后续访问，请在 Party 中断开连接。也可以在[水鱼的已授权应用](https://auth.diving-fish.com/apps)中撤销 Party 的权限。授权过期或被撤销后，需要重新连接。浏览器中已保存的成绩可以在 Party 中单独删除。

<a id="lxns"></a>

## LXNS / 落雪咖啡屋

**国服 Best 50：** 水鱼和落雪导入会保留查分器返回的旧曲 35 个谱面、新曲 15 个谱面及各谱面的 Rating。导出直接使用这一选曲结果，无需选择日服或国际服版本。此前保存的连接需刷新一次以获取该数据。图片反映导入时的查分器数据；在查分器更新成绩后，请再次刷新。缺少封面不会排除已选谱面；不足 50 个谱面时会标明数据不完整。

此连接用于导入已绑定到 LXNS 账号的**舞萌 DX 国服**成绩。LXNS 的设置指南为中文。

1. 登录 [LXNS](https://maimai.lxns.net/) 并检查成绩。如果没有成绩，请先按[同步游戏数据指南](https://maimai.lxns.net/docs/sync)操作。仅注册账号不会添加成绩；首次在线同步会将游戏数据绑定到查分器账号。
2. 在 Party 中打开 LXNS，勾选**我的成绩已更新。**，再选择**连接 LXNS**。使用 **?** 查看说明。在 `maimai.lxns.net` 登录并批准只读授权。玩家无需注册开发者应用或提供个人 API 密钥。
3. 返回 Party，检查玩家、中国区域、个人最佳成绩数量和未匹配谱面。可以仅导入一次，或记住连接以便以后刷新。

导入的是已保存的个人最佳成绩，不包含游玩历史。刷新只会重新读取 LXNS，不会启动机台成绩同步。空结果或读取失败不会删除已保存的数据。如果没有可导入的成绩，请先同步到 LXNS。首次导入失败会丢弃尚未确认的连接，完成设置后需重新连接。

在 Party 中断开连接会移除其保存的授权。你也可以按照[授权说明](https://maimai.lxns.net/docs/mcp)，在 LXNS 个人资料的**第三方应用**中撤销 Party 的权限。浏览器中已保存的成绩可以在 Party 中单独删除。

<a id="mai-tools"></a>

## mai-tools / DX Rating Analyzer

1. 按照[工具设置指南](https://myjian.github.io/mai-tools/#howto)，登录对应的官方 NET 网站，然后运行 **Analyze Self DX Rating**。
2. 在分析器中选择 **Share → Export as JSON (all records)**，保存 `maimai-scores-<timestamp>.json`。
3. 在 Party 中展开 mai-tools，选择 JSON 文件。

如果从分析器导出的是 DXRating 格式，请使用下方的 DXRating 选项。B15/B35 只包含部分成绩。不接受剪贴板 TSV 数据和截图。

<a id="dxrating"></a>

## DXRating

1. 在保存了成绩的浏览器中打开 [My rating](https://dxrating.net/rating)。如有需要，请先用 DXRating 自带的导入工具添加成绩。
2. 选择 **Export... → Export to JSON (all records)**，保存 `dxrating.export-<timestamp>.json`。
3. 在 Party 中展开 DXRating，选择 JSON 文件。

**Export to JSON (B50 records only)** 也可使用，但只包含对应的部分成绩。图片不是成绩数据文件。导出不会获取新的机台成绩。

<a id="tomomai"></a>

## Tomomai

1. 此方式面向高级用户，使用 API 响应。请按 Tomomai 文档在 **Settings → Developer** 中设置个人密钥，并使用自己信任的 API 客户端。Party 没有 API 密钥输入框。
2. 在你使用的 Tomomai 部署上请求 `GET /api/v1/snapshots/latest?region=<region>`，仅保存成功响应的 JSON 正文。密钥需要文档指定的快照元数据和歌曲读取权限。参见[个人密钥指南](https://github.com/shedaniel/tomomai/blob/ee29589979ed37eb0203ab00781d5e70c984ccb2/apps/main/content/developer/guides/api-keys.mdx)。
3. 在 Party 中展开 Tomomai，填写账号标签和对应的区域，再选择 JSON 文件。

B50 响应只包含部分成绩。仅含最近记录的响应会作为成绩记录保留，不会成为 PB，也不会增加游玩次数；一页数据不代表完整历史。目前尚未确认有普通的成绩 JSON 下载按钮。不支持图片和网络请求归档。

<a id="jietng"></a>

## JiETNG v2

1. 如有需要，先完成 [JiETNG 设置和成绩同步](https://jietng.matsuk1.com/en/guide/getting-started)。
2. 在 LINE 私聊中发送 `export json`，或在可用的 Discord 集成中使用 `/export`。请及时下载 JSON，导出链接可能会过期。
3. 在 Party 中展开 JiETNG v2，选择对应的日本版或国际版区域，再选择 `JiETNG-*` JSON 文件。

Party 支持原生第 2 版 JSON，不支持 XML 或 B50 图片。最佳成绩会成为 PB 快照；最近记录仅作为成绩记录保留，不会凭空增加游玩次数。不要在 Party 中输入机器人的 Import Token。

<a id="aqua"></a>

## AquaDX / AquaNet

1. 在你自己的服务器的 AquaNet 网站登录。在设置中选择 **Mai → Export Player Data**。
2. 保存 `AquaDX_maimai2_export_<name>.json`。
3. 在 Party 中展开 AquaDX，选择 JSON 文件。以后更新时请使用相同的账号标签和单独填写的服务器名称。

原生 maimai DX 导出文件包含 PB 和保留的游玩记录，但不一定包含全部历史。不同分支版本可能有所差异。请优先使用此文件，而非 **Export in Batch Manual (for Tachi)**；后者属于下方的独立方式，会丢失原生游玩标识。不支持 SQL 转储和所有游戏的整体备份；无需向 Party 开放私人服务器。

<a id="tachi"></a>

## Tachi BATCH-MANUAL 交换文件

1. 使用明确支持 BATCH-MANUAL 导出的工具，例如 AquaNet 的 **Export in Batch Manual (for Tachi)**。
2. 在 Party 中展开 Kamaitachi，选择**上传 BATCH-MANUAL**，再选择未经修改的 JSON。以后导入时请使用相同的账号和服务器标签。
3. 导入前检查这些成绩记录。

这是一种交换格式，并非 Kamaitachi 原生账号备份。仅支持 maimai DX（`maimaidx`、Single）。这些记录缺少稳定的游玩标识，也无法确立 PB 快照，因此**既不会增加 PB，也不会增加游玩次数**，即使带有时间戳也是如此。

<a id="file-exports"></a>

## 文件身份标识与限制

文件表单会要求填写来源账号标签和游戏区域；私人服务器文件还需单独填写服务器名称。这些内容仅用于本地身份标识，不是登录凭据。以后更新时请重复使用相同标签。不要输入密码、令牌或服务器网址。文件在此浏览器中处理；成绩不会加入分享链接或分析数据。

不同服务、区域和私人服务器会保持为独立玩家。OAuth 身份也与手动标注的文件身份保持独立。导入其他玩家会切换资料。部分导入会保留新文件中缺少的已有 PB。来源中明确的游玩记录只有具备稳定的事件标识时才能加入历史；未知时区不会被推测补全。

精确匹配要求歌曲、艺术家、STD/DX 类型和难度有唯一对应，并在可用时使用来源元数据。存在歧义或未匹配的记录会保留，但不会关联到猜测的谱面。不支持的宴谱记录会在预览中说明。未知数值保持未知。

如果来源没有可用的快照时间戳，Party 会使用文件日期对 PB 快照排序。**较旧的导出数据如被保存为新文件，可能覆盖更新的 PB。** 接受前请检查文件和预览。快照日期和文件日期都不会生成游玩日期或游玩场次。
