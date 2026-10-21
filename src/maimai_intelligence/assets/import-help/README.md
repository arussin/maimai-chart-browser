# Import player data

Open **Import player data** and open the service you use. Follow its steps below and review the player, region, personal bests (PBs), unmatched charts and excluded records before importing. Remembering saves data on this device; importing once keeps it in this tab.

<a id="direct-connections"></a>

## Connections and refresh

Diving-Fish and LXNS use account authorization when the connection is available. Players do not register developer applications. Sign in only on the selected provider's website. Party never asks for its password. Party's connection service keeps an encrypted access grant and account label for refreshes; scores are saved in your browser. Disconnect removes Party's stored grant; for Fish, you can also revoke access in [its authorized apps](https://auth.diving-fish.com/apps). See the LXNS section below for its steps. Maishift and Kamaitachi use public lookups without an authorization grant.

**Refresh reads data already stored by the tracker. It does not acquire new results from SEGA, Wahlap or maimai NET.** Update the tracker first. A refresh date is not a play date. Failed reads preserve saved scores. If availability could not be checked, retry later; this does not mean the operator has disabled the connection.

<a id="session-report"></a>

## Session Report / Party player file

1. Open Session Report in Party and choose its file method. Select an existing compressed player file (.gz) downloaded from Session Report or Party.
2. For a hosted report, choose its report-URL method and paste the URL. An explicitly public report must allow browser access. For a private report, sign in on the report site and choose **Open in Party**, or download its player file; private refresh needs this assisted handoff.
3. Review the profile, then import once or remember it.

Session Report prepares files from Kamaitachi data and retained history. These are not native Kamaitachi account backups.

<a id="maishift"></a>

## Maishift

1. Update your records using [Maishift's guide](https://maimai.shiftpsh.com/en/guide). Complete its NET login/bookmarklet steps on those sites.
2. Open Maishift in Party and enter your public handle or profile URL. No password or developer setup is needed from the player.
3. Read the profile, check its region and PB preview, then import.

Japan and International records stay separate. A URL with `@jp`, `@intl` or `@na` selects that record set; North America uses International records with different chart availability. A bare handle starts with International and uses the region Maishift returns. If both exist, paste the `@jp` URL for Japan. Display language does not select a region, and remembered refresh keeps the selected region.

This imports played-chart PBs, not play history. There is no supported native Maishift backup-file method. An existing Session Report/Party player file uses the separate service above.

<a id="kamaitachi"></a>

## Kamaitachi

1. Use an existing Kamaitachi maimai DX profile with scores. If recent results are missing, update Kamaitachi through its [import page](https://kamai.tachi.ac/import) first. Party does not create a Kamaitachi account or upload arcade scores.
2. Open Kamaitachi in Party. Enter a username, numeric user ID or canonical profile URL such as `https://kamai.tachi.ac/u/username`.
3. Check the resolved player and PB preview carefully: a public lookup does not verify account ownership. Import once, or remember the profile for later refreshes.

Party reads Kamaitachi's public API without a password or API key. This imports the stored maimai DX PBs, including STD and DX charts; it does not import the separate legacy maimai game or lifetime play history. The numeric account ID keeps renamed accounts distinct from other players. Older username-based Session Report identities remain separate.

If the player is found but has no maimai DX scores, add scores in Kamaitachi first, then try again. Refresh in Party reads what Kamaitachi already has. Its retrieval time is not the last arcade play or upstream synchronization time.

For an interchange file, choose **Upload BATCH-MANUAL** in Kamaitachi. See [the file format limits](#tachi); this is not a native Kamaitachi account backup.

<a id="diving-fish"></a>

## Diving-Fish / 水鱼查分器

This connection imports **舞萌 DX (Mainland China / 国服)** scores already stored in Diving-Fish. Its current sign-in, profile settings and setup guides are in Chinese.

1. Open [Diving-Fish](https://maimai.diving-fish.com/), sign in, accept its tracker agreement and confirm your scores are visible there.
2. If you are new to Fish, register and complete email verification when prompted, then follow its [score-import guide](https://maimai.diving-fish.com/manual/docs/category/%E5%AF%BC%E5%85%A5%E6%88%90%E7%BB%A9/). Creating an account does not add arcade scores. Complete the upstream import on Fish before returning to Party.
3. In Fish's **编辑个人资料** (Edit profile), turn off **对非网页查询的成绩使用掩码** (mask scores for non-web queries) for exact scores. Party cannot verify this setting. You can keep **禁止公开接口使用我的成绩（授权不受影响）** enabled: public-query privacy does not block this authorized connection.
4. In Party, open Diving-Fish. Check **My scores are updated.** and **Score masking is off.**, then connect. Use **?** beside a step for details. Sign in and approve the read-only profile and score permissions on `auth.diving-fish.com`.
5. Return to Party and review the resolved player, PB count and unmatched charts before importing once or remembering the connection.

If Fish has no scores, update Fish first. If Party asks you to accept the tracker agreement, open Fish, accept it and check your scores. A remembered connection can then retry its refresh. A failed first import discards the uncommitted connection; connect again after completing setup.

Refresh reads Fish's stored PBs; it does not import new arcade results into Fish or create play history. The retrieval time shows when Party read Fish, not when you last played. Failed or empty reads preserve your saved data, and omitted PBs are retained. Unmatched charts are kept without guessing their identity.

To stop future access, disconnect in Party. You can also revoke Party in [Fish's authorized apps](https://auth.diving-fish.com/apps). If permission expires or is revoked, connect again. Scores already saved in this browser can be removed separately in Party.

<a id="lxns"></a>

## LXNS / 落雪咖啡屋

Use this connection for **舞萌 DX (Mainland China / 国服)** scores already linked to your LXNS account. LXNS's setup instructions are in Chinese.

**Best 50:** Fish and LXNS imports retain the tracker's own older 35/newer 15 selection and chart ratings. Export uses that saved selection without a Japanese/international version picker. Refresh older connections once to obtain it. This reflects the tracker at import time; refresh after updating scores there. Missing artwork does not remove a selected chart. Fewer than 50 returned scores produce a clearly marked partial image.

1. Sign in to [LXNS](https://maimai.lxns.net/) and check your scores. If none appear, follow its [game-data sync guide](https://maimai.lxns.net/docs/sync) first. Creating an account alone does not add scores; the initial online sync links game data to your account.
2. In Party, open LXNS, check **My scores are updated.**, then choose **Connect LXNS**. Use **?** for details. Sign in on `maimai.lxns.net` and approve the read-only request. Players do not need a developer application or personal API key.
3. Return to Party and check the player, China region, PB count and unmatched charts. Import once or remember the connection for refreshes.

Party imports stored PBs, not play history. Refresh reads LXNS again; it does not start arcade-data synchronization. Empty or failed reads preserve saved data. If no supported scores are found, sync scores into LXNS before trying again. A failed first import discards the pending connection, so connect again afterward.

Disconnect in Party to remove its stored grant. You can also revoke Party under **第三方应用** (third-party applications) in LXNS's profile, as described in its [authorization guide](https://maimai.lxns.net/docs/mcp). Saved browser scores can be removed separately in Party.

<a id="mai-tools"></a>

## mai-tools / DX Rating Analyzer

1. Follow the [tool's setup guide](https://myjian.github.io/mai-tools/#howto), sign in to the appropriate official NET site, then run **Analyze Self DX Rating**.
2. In the analyzer, choose **Share → Export as JSON (all records)** and save `maimai-scores-<timestamp>.json`.
3. Open mai-tools in Party and choose the JSON file.

If you exported the analyzer's DXRating format, use DXRating below. B15/B35 is only a subset. Clipboard TSV and screenshots are not accepted.

<a id="dxrating"></a>

## DXRating

1. Open [My rating](https://dxrating.net/rating) in the browser where your records are stored. Populate it with DXRating's own import tools first if needed.
2. Choose **Export... → Export to JSON (all records)** and save `dxrating.export-<timestamp>.json`.
3. Open DXRating in Party and choose the JSON file.

**Export to JSON (B50 records only)** also works, but contains only that subset. An image is not a score file. Exporting does not fetch new cabinet results.

<a id="tomomai"></a>

## Tomomai

1. This is an advanced API-response method. Use Tomomai's documented **Settings → Developer** personal-key setup and your own trusted API client. Party has no API-key field.
2. Save only the successful JSON body from `GET /api/v1/snapshots/latest?region=<region>` on your Tomomai deployment. The key needs the documented snapshot metadata and song-read permissions. See the [personal-key guide](https://github.com/shedaniel/tomomai/blob/ee29589979ed37eb0203ab00781d5e70c984ccb2/apps/main/content/developer/guides/api-keys.mdx).
3. Open Tomomai in Party. Enter your account label and matching region, then choose the JSON file.

B50 responses are partial. Recent-only responses remain observations, not PBs or counted plays; one page is not full history. No ordinary score-JSON download button has been verified. Images and network archives are unsupported.

<a id="jietng"></a>

## JiETNG v2

1. Complete [JiETNG's setup and score synchronization](https://jietng.matsuk1.com/en/guide/getting-started) if needed.
2. Send `export json` in your private LINE conversation, or use `/export` where its Discord integration is available. Download the JSON promptly; export links can expire.
3. Open JiETNG v2 in Party. Select the matching Japan or International region, then choose the `JiETNG-*` JSON file.

Party supports native version 2 JSON, not XML or a B50 image. Best records become PB snapshots; recent rows remain observations without invented play counts. Do not enter a bot Import Token into Party.

<a id="aqua"></a>

## AquaDX / AquaNet

1. Sign in on your own server's AquaNet site. In settings, choose **Mai → Export Player Data**.
2. Save `AquaDX_maimai2_export_<name>.json`.
3. Open AquaDX in Party and choose the JSON file. Use the same account label and separate server name for future updates.

The native maimai DX export contains PBs and retained playlogs, not necessarily lifetime history. Forks may differ. Prefer this file to **Export in Batch Manual (for Tachi)**, which belongs to the separate method below and loses native play identities. SQL dumps and all-games backups are unsupported; you do not need to expose your private server to Party.

<a id="tachi"></a>

## Tachi BATCH-MANUAL interchange file

1. Use a tool that explicitly exports BATCH-MANUAL, such as AquaNet's **Export in Batch Manual (for Tachi)**.
2. In Party, open Kamaitachi and choose **Upload BATCH-MANUAL**. Select the unmodified JSON. Reuse the same account and server labels on later imports.
3. Review the observations before importing.

This is an interchange format, not a native Kamaitachi account backup. Only maimai DX (`maimaidx`, Single) is supported. The rows lack stable play identities and do not establish a PB snapshot, so **they add neither PBs nor counted plays**, even when timestamps are present.

<a id="file-exports"></a>

## File identity and limits

File forms ask for a source account label and game region; private-server files also need a separate server name. These are local identity labels, not login credentials. Reuse them for later updates. Do not enter passwords, tokens or server URLs. Files are processed in this browser; scores are not added to shared links or analytics.

Different providers, regions and private servers remain separate players. An OAuth identity also stays separate from a manually labeled file identity. Importing another player switches profiles. Partial imports retain PBs omitted by the new file. Explicit source play records can contribute history only when they have stable event identities; unknown timezones remain unknown.

Exact, unique chart matches use song, artist, STD/DX format and difficulty, with source metadata where available. Ambiguous or unmatched rows are preserved without attaching them to a guessed chart. Unsupported Utage rows are disclosed in the preview. Unknown measurements stay unknown.

Without a usable source snapshot timestamp, Party uses the file date to order PB snapshots. **An old export saved as a new file can replace newer PBs.** Check the file and preview before accepting. Neither a snapshot date nor a file date creates a play date or session.
