/** Existing DOM behavior with explicit module dependencies. */
export function createPlayerMaishift(ports) {
  let maishift;
  /* Public Maishift observations. Connection locations never enter portable data. */
  (() => {
    'use strict';
    const core = ports.playerCore;
    const fail = () => {
      throw new Error('Maishift returned an unsupported response. Your saved data was kept.');
    };
    // Korean's default links omit the locale. Keep all supported profile tabs and
    // encoded region separators in one parser so location and region hints agree.
    function profileURL(value) {
      const url = new URL(value),
        path = url.pathname.replace(/%40/gi, '@');
      const match =
        /^\/(?:(?:en|ko|ja|zh-TW)(?:@(na|intl|jp))?\/)?profile\/([A-Za-z0-9_-]{1,64})(?:\/(?:home|records|export|grinding|playlists|s_rating|stamp))?\/?$/.exec(
          path,
        );
      if (
        url.origin !== 'https://maimai.shiftpsh.com' ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash ||
        !match
      )
        throw new Error('Enter a Maishift handle or a public profile URL.');
      return { handle: match[2], region: match[1] ? (match[1] === 'jp' ? 'jp' : 'intl') : null };
    }
    function location(value, region) {
      if (typeof value !== 'string')
        throw new Error('Enter a Maishift handle or a public profile URL.');
      let handle = value.trim(),
        parsed = null;
      if (handle.includes('://')) {
        try {
          parsed = profileURL(handle);
        } catch {
          throw new Error('Enter a Maishift handle or a public profile URL.');
        }
        handle = parsed.handle;
      }
      if (region === undefined) region = parsed?.region || 'auto';
      if (!['intl', 'jp', 'auto'].includes(region))
        throw new Error('Choose the game region for this profile.');
      if (parsed?.region && parsed.region !== region)
        throw new Error('The profile URL and selected game region do not match.');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(handle))
        throw new Error('Enter a Maishift handle or a public profile URL.');
      return {
        handle,
        region,
        url:
          'https://maimai.shiftpsh.com/en' +
          (region === 'auto' ? '' : '@' + region) +
          '/profile/' +
          handle +
          '/home',
      };
    }
    const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const integer = (v, max = Number.MAX_SAFE_INTEGER) =>
      Number.isSafeInteger(v) && v >= 0 && v <= max;
    // Maishift's public client derives ranks from these exact achievement units.
    // This is a display projection, not an extra source observation or play.
    const gradeThresholds = [
      [1005000, 'SSS+'],
      [1000000, 'SSS'],
      [995000, 'SS+'],
      [990000, 'SS'],
      [980000, 'S+'],
      [970000, 'S'],
      [940000, 'AAA'],
      [900000, 'AA'],
      [800000, 'A'],
      [750000, 'BBB'],
      [700000, 'BB'],
      [600000, 'B'],
      [500000, 'C'],
      [0, 'D'],
    ];
    function grade(achievement) {
      return integer(achievement, 1010000)
        ? gradeThresholds.find(([minimum]) => achievement >= minimum)[1]
        : '';
    }
    const text = (v, max = 512) =>
      typeof v === 'string' && v.length <= max && !/[\x00-\x1f\uD800-\uDFFF]/u.test(v);
    function regionFromURL(value) {
      try {
        return profileURL(value.trim()).region;
      } catch {
        return null;
      }
    }
    async function normalize(envelope, selected) {
      if (
        !object(envelope) ||
        envelope.schemaVersion !== 1 ||
        ![1, 2].includes(envelope.adapterVersion) ||
        envelope.provider !== 'maishift'
      )
        fail();
      const p = envelope.identity,
        c = envelope.coverage;
      if (
        !object(p) ||
        p.handle !== selected.handle ||
        !['intl', 'jp'].includes(p.region) ||
        (selected.region !== 'auto' && p.region !== selected.region) ||
        !text(p.displayName, 200) ||
        !p.displayName ||
        !integer(p.createdAt) ||
        !integer(p.updatedAt) ||
        p.updatedAt < p.createdAt
      )
        fail();
      if (p.rating != null && !integer(p.rating, 1000000)) fail();
      if (
        !object(c) ||
        c.kind !== 'partial' ||
        !['totalCharts', 'playedCharts', 'importedCharts', 'diagnosticCount'].every((k) =>
          integer(c[k], 20000),
        ) ||
        c.playedCharts > c.totalCharts ||
        c.importedCharts + c.diagnosticCount !== c.playedCharts
      )
        fail();
      if (
        !Array.isArray(envelope.records) ||
        envelope.records.length !== c.importedCharts ||
        !Array.isArray(envelope.diagnostics) ||
        envelope.diagnostics.length !== Math.min(100, c.diagnosticCount)
      )
        fail();
      const diagnostics = envelope.diagnostics.map((d) => {
        if (
          !object(d) ||
          !integer(d.rowIndex, 19999) ||
          d.rowIndex >= c.totalCharts ||
          d.reason !== 'insufficient_chart_identity'
        )
          fail();
        return { rowIndex: d.rowIndex, reason: d.reason };
      });
      const player = {
        key: 'maishift:maimaidx:' + p.region + ':' + encodeURIComponent(p.handle),
        provider: 'maishift',
        game: 'maimaidx',
        username: p.handle,
        displayName: p.displayName,
      };
      const data = {
          format: 'maimai-player-data',
          schemaVersion: 1,
          player,
          charts: {},
          records: {},
          plays: {},
          snapshots: {},
          captures: {},
        },
        pbs = {},
        records = [];
      for (const row of envelope.records) {
        if (
          !object(row) ||
          !/^\d{1,16}$/.test(row.id) ||
          !integer(Number(row.id)) ||
          Number(row.id) === 0 ||
          String(Number(row.id)) !== row.id ||
          !['STD', 'DX'].includes(row.format) ||
          !['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'].includes(row.difficulty)
        )
          fail();
        if (
          !['title', 'artist', 'level', 'lamp', 'sync'].every((k) => text(row[k])) ||
          (row.achievement !== null && !integer(row.achievement, 1010000)) ||
          (row.constant !== null && !integer(row.constant, 200))
        )
          fail();
        if (!['dxScore', 'maxDxScore', 'rate'].every((k) => row[k] === null || integer(row[k])))
          fail();
        const chartID = 'maishift:' + p.region + ':' + row.id;
        if (Object.hasOwn(data.charts, chartID)) fail();
        // Portable records retain provider IDs. A reviewed crosswalk is applied
        // only when displaying them, without rewriting or dropping source data.
        data.charts[chartID] = {
          chartID,
          songID: chartID,
          title: row.title,
          artist: row.artist,
          format: row.format,
          difficulty: row.difficulty,
          level: row.level,
          constant: row.constant,
          displayVersion: '',
          inGameID: null,
        };
        const record = {
          chartID,
          achievement: row.achievement,
          grade: '',
          rate: row.rate,
          lamp: row.lamp,
          sync: row.sync,
          constant: row.constant,
          displayVersion: '',
          timeAchieved: null,
          dxScore: row.dxScore,
          maxDxScore: row.maxDxScore,
          maxCombo: null,
          fast: null,
          slow: null,
          miss: null,
          good: null,
          great: null,
          perfect: null,
          pcrit: null,
        };
        records.push(record);
      }
      // WebKit's individual WebCrypto round trips make thousands of serial hashes
      // slow. Match the validator's bounded batches while retaining identical IDs.
      for (let start = 0; start < records.length; start += 128) {
        const batch = records.slice(start, start + 128),
          ids = await Promise.all(batch.map((record) => core.digest(record)));
        batch.forEach((record, i) => {
          data.records[ids[i]] = record;
          pbs[record.chartID] = ids[i];
        });
      }
      const snapshot = {
          capturedAt: p.updatedAt,
          phase: 'after',
          complete: false,
          versions: [],
          pbs,
        },
        sid = await core.digest(snapshot);
      data.snapshots[sid] = snapshot;
      const capture = {
        capturedAt: p.updatedAt,
        sourceKind: 'maishift-public-pbs',
        sourceID: player.key,
        sessionID: '',
        historyCoverage: 'none',
        playIDs: [],
        snapshotIDs: [sid],
      };
      data.captures[await core.digest(capture)] = capture;
      data.revision = await core.digest(data);
      await core.validate(data);
      return {
        data,
        adapterVersion: envelope.adapterVersion,
        diagnostics,
        coverage: { ...c },
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        profileRating: p.rating ?? null,
      };
    }
    async function enrichRatings(existing, incoming) {
      // Adapter v1 omitted ratings. Fill only unknown ratings at the SAME source
      // observation, without dating new information backwards or creating history.
      if (existing.player.provider !== 'maishift' || existing.player.key !== incoming.player.key)
        return existing;
      const time = core.offer(incoming).capturedAt;
      if (time !== core.offer(existing).capturedAt) return existing;
      const observed = core.current(incoming).pbs,
        eligible = new Set(),
        incomingIDs = new Map(Object.entries(incoming.records).map(([id, row]) => [row, id]));
      for (const c of Object.values(existing.captures))
        if (
          c.sourceKind === 'maishift-public-pbs' &&
          c.sourceID === existing.player.key &&
          c.capturedAt === time &&
          c.playIDs.length === 0 &&
          c.sessionID === '' &&
          c.historyCoverage === 'none'
        )
          for (const id of c.snapshotIDs) eligible.add(id);
      const result = structuredClone(existing),
        snapshotIDs = new Map();
      let changed = false;
      for (const sid of eligible) {
        const snapshot = existing.snapshots[sid];
        if (snapshot.capturedAt !== time || snapshot.phase !== 'after' || snapshot.complete)
          continue;
        const updated = structuredClone(snapshot);
        let filled = false;
        for (const [cid, ref] of Object.entries(snapshot.pbs)) {
          const old = existing.records[ref],
            row = observed.get(cid);
          if (
            old.rate !== null ||
            row?.rate == null ||
            core.canonical({ ...old, rate: row.rate }) !== core.canonical(row) ||
            core.canonical(existing.charts[cid]) !== core.canonical(incoming.charts[cid])
          )
            continue;
          const id = incomingIDs.get(row);
          result.records[id] = row;
          updated.pbs[cid] = id;
          filled = true;
        }
        if (filled) {
          const id = await core.digest(updated);
          delete result.snapshots[sid];
          result.snapshots[id] = updated;
          snapshotIDs.set(sid, id);
          changed = true;
        }
      }
      if (!changed) return existing;
      result.captures = {};
      for (const capture of Object.values(existing.captures)) {
        const updated = {
          ...capture,
          snapshotIDs: capture.snapshotIDs.map((id) => snapshotIDs.get(id) || id),
        };
        result.captures[await core.digest(updated)] = updated;
      }
      const used = new Set([
        ...Object.values(result.plays),
        ...Object.values(result.snapshots).flatMap((s) => Object.values(s.pbs)),
      ]);
      for (const id of Object.keys(result.records)) if (!used.has(id)) delete result.records[id];
      const { revision, ...body } = result;
      result.revision = await core.digest(body);
      return core.validate(result);
    }
    function matchChart(player, chart, row, target) {
      if (!row || !target || !chart || player?.provider !== 'maishift') return false;
      const identity = player.key.split(':'),
        source = row.expected_source;
      return (
        identity.length === 4 &&
        identity[0] === 'maishift' &&
        identity[1] === 'maimaidx' &&
        ['intl', 'jp'].includes(identity[2]) &&
        new RegExp('^maishift:' + identity[2] + ':[1-9][0-9]{0,15}$').test(chart.chartID) &&
        row.acceptance_basis === 'reviewed' &&
        row.chart_id === target.chart_id &&
        ['title', 'artist', 'format', 'difficulty'].every(
          (k) => typeof source?.[k] === 'string' && source[k] === chart[k],
        ) &&
        ['format', 'difficulty'].every((k) => source[k] === target[k])
      );
    }
    maishift = Object.freeze({
      location,
      regionFromURL,
      normalize,
      matchChart,
      enrichRatings,
      grade,
    });
  })();

  return maishift;
}
