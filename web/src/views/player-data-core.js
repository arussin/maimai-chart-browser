/** Existing DOM behavior with explicit module dependencies. */
export function createPlayerDataCore(ports) {
  let playerCore;
  /* maimai-player-data v1. No network or application dependencies. */
  (() => {
    'use strict';
    const MAX_COMPRESSED = 32 * 1024 * 1024,
      MAX_DECODED = 128 * 1024 * 1024,
      HEX = /^[a-f0-9]{64}$/;
    const fail = (message) => {
      throw new Error(message);
    };
    const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    const keys = (value, names) =>
      object(value) && Object.keys(value).sort().join('|') === [...names].sort().join('|');
    const text = (v, max = 512, empty = false) =>
      typeof v === 'string' &&
      v.length <= max &&
      (empty || v.length > 0) &&
      !/[\x00-\x1f\uD800-\uDFFF]/u.test(v);
    const integer = (v, max = Number.MAX_SAFE_INTEGER, nullable = false) =>
      (nullable && v === null) || (Number.isSafeInteger(v) && v >= 0 && v <= max);
    function canonical(v) {
      if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
      if (object(v))
        return (
          '{' +
          Object.keys(v)
            .sort()
            .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
            .join(',') +
          '}'
        );
      return JSON.stringify(v);
    }
    async function hash(v) {
      const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : v;
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    const digest = (v) => hash(canonical(v));
    const recordFields = [
      'chartID',
      'achievement',
      'grade',
      'rate',
      'lamp',
      'sync',
      'constant',
      'displayVersion',
      'timeAchieved',
      'dxScore',
      'maxDxScore',
      'maxCombo',
      'fast',
      'slow',
      'miss',
      'good',
      'great',
      'perfect',
      'pcrit',
    ];
    const chartFields = [
      'chartID',
      'songID',
      'title',
      'artist',
      'format',
      'difficulty',
      'level',
      'constant',
      'displayVersion',
      'inGameID',
    ];
    function validPlayer(p) {
      if (
        !keys(p, ['key', 'provider', 'game', 'username', 'displayName']) ||
        !Object.values(p).every((v) => text(v, 200)) ||
        p.game !== 'maimaidx'
      )
        return false;
      if (p.provider === 'kamaitachi')
        return p.key === 'kamaitachi:maimaidx:' + p.username.toLowerCase();
      // This is our portable identity namespace, not an assertion about upstream
      // handles or region resolution. The live Maishift adapter remains disabled.
      if (p.provider === 'maishift')
        return ['jp', 'intl'].some(
          (region) =>
            p.key === 'maishift:maimaidx:' + region + ':' + encodeURIComponent(p.username),
        );
      return false;
    }
    function structure(d) {
      if (
        !keys(d, [
          'format',
          'schemaVersion',
          'revision',
          'player',
          'charts',
          'records',
          'plays',
          'snapshots',
          'captures',
        ]) ||
        d.format !== 'maimai-player-data' ||
        d.schemaVersion !== 1
      )
        fail('Unsupported player file. Choose a maimai-player-data v1 export.');
      const p = d.player;
      if (!validPlayer(p)) fail('Invalid player identity.');
      for (const name of ['charts', 'records', 'plays', 'snapshots', 'captures'])
        if (
          !object(d[name]) ||
          Object.keys(d[name]).length > 1000000 ||
          !Object.keys(d[name]).every(
            (k) => text(k, 256) && !['__proto__', 'constructor', 'prototype'].includes(k),
          )
        )
          fail('Invalid or oversized player collection.');
      if (
        p.provider === 'maishift' &&
        Object.keys(d.charts).some(
          (id) =>
            !id.startsWith('maishift:' + p.key.split(':')[2] + ':') ||
            id.split(':').slice(2).join(':') === '',
        )
      )
        fail('Invalid chart reference.');
      for (const [id, c] of Object.entries(d.charts))
        if (
          !keys(c, chartFields) ||
          c.chartID !== id ||
          !['STD', 'DX'].includes(c.format) ||
          !['chartID', 'songID', 'format', 'difficulty'].every((k) => text(c[k], 256)) ||
          !['title', 'artist', 'level', 'displayVersion'].every((k) => text(c[k], 512, true)) ||
          !integer(c.constant, 200, true) ||
          !integer(c.inGameID, undefined, true)
        )
          fail('Invalid chart reference.');
      for (const [id, r] of Object.entries(d.records)) {
        if (
          !HEX.test(id) ||
          !keys(r, recordFields) ||
          typeof r.chartID !== 'string' ||
          !Object.hasOwn(d.charts, r.chartID) ||
          !integer(r.achievement, 1010000, true) ||
          !integer(r.constant, 200, true)
        )
          fail('Invalid score observation.');
        for (const k of ['grade', 'lamp', 'sync', 'displayVersion'])
          if (!text(r[k], 512, true)) fail('Invalid score text.');
        for (const k of recordFields.filter(
          (k) =>
            ![
              'chartID',
              'achievement',
              'constant',
              'grade',
              'lamp',
              'sync',
              'displayVersion',
            ].includes(k),
        ))
          if (!integer(r[k], undefined, true)) fail('Invalid score measurement.');
      }
      for (const ref of Object.values(d.plays))
        if (typeof ref !== 'string' || !Object.hasOwn(d.records, ref))
          fail('Missing play observation.');
      for (const [id, s] of Object.entries(d.snapshots)) {
        if (
          !HEX.test(id) ||
          !keys(s, ['capturedAt', 'phase', 'complete', 'versions', 'pbs']) ||
          !integer(s.capturedAt) ||
          !['before', 'after'].includes(s.phase) ||
          typeof s.complete !== 'boolean' ||
          !Array.isArray(s.versions) ||
          !s.versions.every((v) => text(v)) ||
          !object(s.pbs)
        )
          fail('Invalid PB snapshot.');
        for (const [cid, ref] of Object.entries(s.pbs))
          if (
            typeof ref !== 'string' ||
            !Object.hasOwn(d.records, ref) ||
            d.records[ref].chartID !== cid
          )
            fail('PB chart mismatch.');
      }
      for (const [id, c] of Object.entries(d.captures)) {
        if (
          !HEX.test(id) ||
          !keys(c, [
            'capturedAt',
            'sourceKind',
            'sourceID',
            'sessionID',
            'historyCoverage',
            'playIDs',
            'snapshotIDs',
          ]) ||
          !integer(c.capturedAt) ||
          !['sourceKind', 'sourceID', 'sessionID', 'historyCoverage'].every((k) =>
            text(c[k], 512, true),
          )
        )
          fail('Invalid capture.');
        for (const [k, collection] of [
          ['playIDs', 'plays'],
          ['snapshotIDs', 'snapshots'],
        ])
          if (
            !Array.isArray(c[k]) ||
            new Set(c[k]).size !== c[k].length ||
            !c[k].every((ref) => typeof ref === 'string' && Object.hasOwn(d[collection], ref))
          )
            fail('Missing capture observations.');
      }
      if (!HEX.test(d.revision)) fail('Invalid dataset revision.');
      return d;
    }
    async function validate(d) {
      structure(d);
      const { revision, ...body } = d;
      if ((await digest(body)) !== revision) fail('Player file integrity check failed.');
      for (const name of ['records', 'snapshots', 'captures']) {
        const rows = Object.entries(d[name]);
        for (let i = 0; i < rows.length; i += 128)
          await Promise.all(
            rows.slice(i, i + 128).map(async ([id, row]) => {
              if ((await digest(row)) !== id) fail('Observation integrity check failed.');
            }),
          );
      }
      return d;
    }
    async function bounded(stream, maximum) {
      const reader = stream.getReader(),
        chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maximum) fail('Player history exceeds its size limit; nothing was replaced.');
          chunks.push(value);
        }
      } catch (e) {
        await reader.cancel().catch(() => {});
        throw e;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      return bytes;
    }
    async function decode(input) {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      if (bytes.length > MAX_COMPRESSED) fail('Player file exceeds 32 MiB.');
      if (typeof DecompressionStream === 'undefined')
        fail('This browser cannot read compressed player files. Please update your browser.');
      try {
        const raw = await bounded(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
          MAX_DECODED,
        );
        return await validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
      } catch (e) {
        throw new Error(e.message || 'Invalid compressed player file.');
      }
    }
    async function encode(d) {
      structure(d);
      const raw = new TextEncoder().encode(canonical(d));
      if (raw.length > MAX_DECODED) fail('Expanded player history exceeds 128 MiB.');
      return bounded(
        new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),
        MAX_COMPRESSED,
      );
    }
    function current(d) {
      let refs = {},
        snapshot = null;
      for (const [id, s] of Object.entries(d.snapshots).sort(
        ([a, x], [b, y]) =>
          x.capturedAt - y.capturedAt ||
          Number(x.phase === 'after') - Number(y.phase === 'after') ||
          (a < b ? -1 : a > b ? 1 : 0),
      )) {
        if (s.complete) refs = {};
        Object.assign(refs, s.pbs);
        snapshot = s;
      }
      return {
        pbs: new Map(Object.entries(refs).map(([cid, ref]) => [cid, d.records[ref]])),
        snapshot,
      };
    }
    function chartHistory(d, chartIDs) {
      const ids = new Set(chartIDs),
        plays = Object.entries(d.plays)
          .map(([id, ref]) => ({ id, r: d.records[ref] }))
          .filter((e) => ids.has(e.r.chartID))
          .map((e) => ({ ...e, time: e.r.timeAchieved }));
      plays.sort((a, b) => (b.time ?? -1) - (a.time ?? -1) || a.id.localeCompare(b.id));
      const changes = [];
      let previous = null,
        previousRecord = null;
      for (const [id, s] of Object.entries(d.snapshots).sort(
        ([a, x], [b, y]) =>
          x.capturedAt - y.capturedAt ||
          Number(x.phase === 'after') - Number(y.phase === 'after') ||
          a.localeCompare(b),
      )) {
        const cid = chartIDs.find((cid) => s.pbs[cid]);
        if (!cid) continue;
        const r = d.records[s.pbs[cid]],
          key = canonical([r.achievement, r.grade, r.rate, r.lamp, r.sync]);
        // Learning a previously unknown Maishift contribution is metadata, not a
        // new PB. Keep observation dates and known-to-known corrections intact.
        const enrichment =
          d.player.provider === 'maishift' &&
          previousRecord &&
          (previousRecord.rate === null || r.rate === null) &&
          canonical([r.achievement, r.grade, r.lamp, r.sync]) ===
            canonical([
              previousRecord.achievement,
              previousRecord.grade,
              previousRecord.lamp,
              previousRecord.sync,
            ]);
        if (key !== previous && !enrichment) changes.push({ id, time: s.capturedAt, r });
        previous = key;
        previousRecord = r;
      }
      return { plays, changes: changes.reverse() };
    }
    function profile(d, pbs, snapshot) {
      let rating = null;
      const rows = [...pbs.values()];
      if (
        snapshot?.complete &&
        snapshot.versions.length &&
        rows.every((r) => r.rate !== null && r.displayVersion)
      )
        rating = [
          [false, 35],
          [true, 15],
        ].reduce(
          (sum, [isNew, slots]) =>
            sum +
            rows
              .filter((r) => snapshot.versions.includes(r.displayVersion) === isNew)
              .map((r) => r.rate)
              .sort((a, b) => b - a)
              .slice(0, slots)
              .reduce((a, b) => a + b, 0),
          0,
        );
      return {
        rating,
        sessionCount: new Set(
          Object.values(d.captures)
            .map((c) => c.sessionID)
            .filter(Boolean),
        ).size,
      };
    }
    function offer(d) {
      const { pbs, snapshot } = current(d);
      return {
        format: d.format,
        schemaVersion: 1,
        revision: d.revision,
        player: d.player,
        capturedAt: snapshot?.capturedAt || 0,
        pbCount: pbs.size,
        pbCoverage: snapshot?.complete ? 'complete' : 'partial',
        playCount: Object.keys(d.plays).length,
        snapshotIDs: Object.keys(d.snapshots).sort(),
        captureIDs: Object.keys(d.captures).sort(),
        historyCoverage: 'retained-only',
        profile: profile(d, pbs, snapshot),
      };
    }
    function validateOffer(o) {
      if (
        !object(o) ||
        o.format !== 'maimai-player-data' ||
        o.schemaVersion !== 1 ||
        !HEX.test(o.revision) ||
        !validPlayer(o.player) ||
        !integer(o.capturedAt) ||
        !integer(o.pbCount, 1000000) ||
        !['complete', 'partial'].includes(o.pbCoverage) ||
        o.historyCoverage !== 'retained-only' ||
        !integer(o.playCount, 1000000)
      )
        fail('Invalid report data offer.');
      for (const k of ['snapshotIDs', 'captureIDs'])
        if (
          !Array.isArray(o[k]) ||
          o[k].length > 100000 ||
          !o[k].every((x) => typeof x === 'string' && HEX.test(x))
        )
          fail('Invalid report history offer.');
      if (
        Object.hasOwn(o, 'profile') &&
        (!keys(o.profile, ['rating', 'sessionCount']) ||
          !integer(o.profile.rating, undefined, true) ||
          !integer(o.profile.sessionCount, 1000000))
      )
        fail('Invalid player profile.');
      return o;
    }
    function needsUpdate(d, o) {
      validateOffer(o);
      if (!d || d.player.key !== o.player.key) return true;
      if (d.revision === o.revision) return false;
      return (
        o.snapshotIDs.some((id) => !Object.hasOwn(d.snapshots, id)) ||
        o.captureIDs.some((id) => !Object.hasOwn(d.captures, id))
      );
    }
    function observationDates(d) {
      const dates = { charts: {}, plays: {} };
      for (const c of Object.values(d.captures))
        for (const id of c.playIDs) dates.plays[id] = Math.max(dates.plays[id] || 0, c.capturedAt);
      for (const [id, time] of Object.entries(dates.plays)) {
        const cid = d.records[d.plays[id]].chartID;
        dates.charts[cid] = Math.max(dates.charts[cid] || 0, time);
      }
      for (const s of Object.values(d.snapshots))
        for (const cid of Object.keys(s.pbs))
          dates.charts[cid] = Math.max(dates.charts[cid] || 0, s.capturedAt);
      return dates;
    }
    async function reconcile(d) {
      const proposals = new Map(),
        blocked = new Set(),
        legacy = /^legacy:[a-f0-9]{64}$/;
      for (const capture of Object.values(d.captures)) {
        const groups = new Map();
        for (const id of capture.playIDs) {
          const r = d.records[d.plays[id]];
          if (!r.timeAchieved || r.achievement === null) continue;
          const key = canonical([r.chartID, r.timeAchieved, r.achievement]);
          if (!groups.has(key)) groups.set(key, [[], []]);
          groups.get(key)[Number(legacy.test(id))].push(id);
        }
        for (const [sources, summaries] of groups.values()) {
          if (sources.length > 64 || summaries.length > 64) {
            summaries.forEach((id) => blocked.add(id));
            continue;
          }
          const matches = new Map();
          for (const id of summaries) {
            const weak = d.records[d.plays[id]],
              candidates = sources.filter((source) =>
                Object.entries(weak).every(
                  ([field, value]) =>
                    value === null || value === '' || value === d.records[d.plays[source]][field],
                ),
              );
            if (candidates.length === 1) {
              const source = candidates[0];
              if (!matches.has(source)) matches.set(source, []);
              matches.get(source).push(id);
            } else if (candidates.length > 1) blocked.add(id);
          }
          for (const [source, ids] of matches) {
            if (ids.length === 1) {
              if (!proposals.has(ids[0])) proposals.set(ids[0], new Set());
              proposals.get(ids[0]).add(source);
            } else ids.forEach((id) => blocked.add(id));
          }
        }
      }
      const aliases = new Map(
        [...proposals]
          .filter(([id, ids]) => ids.size === 1 && !blocked.has(id))
          .map(([id, ids]) => [id, [...ids][0]]),
      );
      if (!aliases.size) return d;
      const result = structuredClone(d);
      for (const id of aliases.keys()) delete result.plays[id];
      result.captures = {};
      for (const c of Object.values(d.captures)) {
        const updated = {
          ...c,
          playIDs: [...new Set(c.playIDs.map((id) => aliases.get(id) || id))].sort(),
        };
        result.captures[await digest(updated)] = updated;
      }
      const { revision, ...body } = result;
      result.revision = await digest(body);
      return structure(result);
    }
    async function merge(a, b) {
      structure(a);
      structure(b);
      if (a.player.key !== b.player.key) fail('Different players cannot be merged.');
      const d = structuredClone(a),
        at = offer(a).capturedAt,
        bt = offer(b).capturedAt,
        ad = observationDates(a),
        bd = observationDates(b);
      if (bt > at || (bt === at && canonical(b.player) >= canonical(a.player)))
        d.player = structuredClone(b.player);
      for (const name of ['records', 'snapshots', 'captures'])
        for (const [id, row] of Object.entries(b[name])) {
          if (Object.hasOwn(d[name], id) && canonical(d[name][id]) !== canonical(row))
            fail('Conflicting retained observation.');
          d[name][id] = row;
        }
      for (const name of ['charts', 'plays'])
        for (const [id, row] of Object.entries(b[name])) {
          const old = d[name][id];
          if (
            old === undefined ||
            (bd[name][id] || 0) > (ad[name][id] || 0) ||
            ((bd[name][id] || 0) === (ad[name][id] || 0) && canonical(row) >= canonical(old))
          )
            d[name][id] = row;
        }
      const { revision, ...body } = d;
      d.revision = await digest(body);
      return reconcile(structure(d));
    }
    playerCore = Object.freeze({
      validPlayer,
      validate,
      structure,
      decode,
      encode,
      current,
      offer,
      validateOffer,
      needsUpdate,
      merge,
      reconcile,
      chartHistory,
      hash,
      digest,
      canonical,
      bounded,
      MAX_COMPRESSED,
      MAX_DECODED,
    });
  })();

  return playerCore;
}
