# Import player data

Open **Import player data**, open the service you use, then choose an **Import method** inside that service. Follow its steps below and review the player, region, personal bests (PBs), unmatched charts and excluded records before importing. Remembering saves data on this device; importing once keeps it in this tab.

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
2. Open Maishift in Party, choose **Public profile**, and enter your public handle or profile URL. No password or developer setup is needed from the player.
3. Read the profile, check its region and PB preview, then import.

Japan and International records stay separate. A URL with `@jp`, `@intl` or `@na` selects that record set; North America uses International records with different chart availability. A bare handle starts with International and uses the region Maishift returns. If both exist, paste the `@jp` URL for Japan. Display language does not select a region, and remembered refresh keeps the selected region.

This imports played-chart PBs, not play history. There is no supported native Maishift backup-file method. An existing Session Report/Party player file uses the separate service above.

<a id="kamaitachi"></a>

## Kamaitachi

1. Use an existing Kamaitachi maimai DX profile with scores. If recent results are missing, update Kamaitachi through its [import page](https://kamai.tachi.ac/import) first. Party does not create a Kamaitachi account or upload arcade scores.
2. Open Kamaitachi in Party and choose **Import by username**. Enter a username, numeric user ID or canonical profile URL such as `https://kamai.tachi.ac/u/username`.
3. Check the resolved player and PB preview carefully: a public lookup does not verify account ownership. Import once, or remember the profile for later refreshes.

Party reads Kamaitachi's public API without a password or API key. This imports the stored maimai DX PBs, including STD and DX charts; it does not import the separate legacy maimai game or lifetime play history. The numeric account ID keeps renamed accounts distinct from other players. Older username-based Session Report identities remain separate.

If the player is found but has no maimai DX scores, add scores in Kamaitachi first, then try again. Refresh in Party reads what Kamaitachi already has. Its retrieval time is not the last arcade play or upstream synchronization time.

<a id="diving-fish"></a>

## Diving-Fish / 水鱼查分器

This connection imports China-region scores already stored in Diving-Fish. Its current sign-in, profile settings and setup guides are in Chinese.

1. Open [Diving-Fish](https://maimai.diving-fish.com/), sign in, accept its tracker agreement and confirm your scores are visible there.
2. If you are new to Fish, register and complete email verification when prompted, then follow its [score-import guide](https://maimai.diving-fish.com/manual/docs/category/%E5%AF%BC%E5%85%A5%E6%88%90%E7%BB%A9/). Creating an account does not add arcade scores. Complete the upstream import on Fish before returning to Party.
3. In Fish's **编辑个人资料** (Edit profile), turn off **对非网页查询的成绩使用掩码** (mask scores for non-web queries) for exact scores. Party cannot verify this setting. You can keep **禁止公开接口使用我的成绩（授权不受影响）** enabled: public-query privacy does not block this authorized connection.
4. In Party, open Diving-Fish and choose **Connect directly**. Confirm that masking is off, then connect. Sign in and approve the read-only profile and score permissions on `auth.diving-fish.com`.
5. Return to Party and review the resolved player, PB count and unmatched charts before importing once or remembering the connection.

If Fish has no scores, update Fish first. If Party asks you to accept the tracker agreement, open Fish, accept it and check your scores. A remembered connection can then retry its refresh. A failed first import discards the uncommitted connection; connect again after completing setup.

Refresh reads Fish's stored PBs; it does not import new arcade results into Fish or create play history. The retrieval time shows when Party read Fish, not when you last played. Failed or empty reads preserve your saved data, and omitted PBs are retained. Unmatched charts are kept without guessing their identity.

To stop future access, disconnect in Party. You can also revoke Party in [Fish's authorized apps](https://auth.diving-fish.com/apps). If permission expires or is revoked, connect again. Scores already saved in this browser can be removed separately in Party.

<a id="lxns"></a>

## LXNS / 落雪咖啡屋

Use this connection for China-region maimai DX scores already linked to your LXNS account. LXNS's setup instructions are in Chinese.

1. Sign in to [LXNS](https://maimai.lxns.net/) and check your scores. If none appear, follow its [game-data sync guide](https://maimai.lxns.net/docs/sync) first. Creating an account alone does not add scores; the initial online sync links game data to your account.
2. In Party, open LXNS, choose **Connect directly**, then **Connect LXNS**. Sign in on `maimai.lxns.net` and approve the read-only request. Players do not need a developer application or personal API key.
3. Return to Party and check the player, China region, PB count and unmatched charts. Import once or remember the connection for refreshes.

Party imports stored PBs, not play history. Refresh reads LXNS again; it does not start arcade-data synchronization. Empty or failed reads preserve saved data. If no supported scores are found, sync scores into LXNS before trying again. A failed first import discards the pending connection, so connect again afterward.

Disconnect in Party to remove its stored grant. You can also revoke Party under **第三方应用** (third-party applications) in LXNS's profile, as described in its [authorization guide](https://maimai.lxns.net/docs/mcp). Saved browser scores can be removed separately in Party.
