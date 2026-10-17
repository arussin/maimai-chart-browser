import type { createPlayerDataCore } from './player-data-core';
import type {
  PlayerChart,
  PlayerDataset,
  PlayerIdentity,
  PlayerRecord,
} from '../domain/player-data';
import type { ProviderRow } from '../player-session';
import type { CatalogChart } from '../runtime/catalog';
import { ImportFailureError, importFailure, transportFailure } from '../runtime/import-failure';
import { DiagnosticError, diagnosticError } from '../runtime/diagnostic-error';
import { sourceRequest } from '../runtime/source-transport';

export interface KamaitachiPorts {
  core: Pick<ReturnType<typeof createPlayerDataCore>, 'validate' | 'digest' | 'bounded'>;
  fetch?: typeof fetch;
  now?: () => number;
}

// Public v3 contracts pinned to zkldi/Tachi b38e07245b629237ce7041db9e95d603a1299694:
// server/.../users/_userID/games/_game/_playtype/pbs/router.ts (game-only URL),
// server/src/lib/db-formats/{chart,pb,song}.ts and common/src/config/game-support/maimai-dx.ts.
// A PB may combine best percent and best lamp from different plays. It is never a play.
export function createPlayerKamaitachi(ports: KamaitachiPorts) {
  const core = ports.core,
    request = ports.fetch ?? globalThis.fetch,
    now = ports.now ?? Date.now,
    origin = 'https://kamai.tachi.ac',
    maxRows = 20000;
  function fail(): never {
    throw new ImportFailureError(
      'Kamaitachi returned an unsupported response. Your saved data was kept.',
      'invalid_response',
    );
  }
  const object = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);
  const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
  const text = (v: unknown, max = 512): v is string =>
    typeof v === 'string' && v.length <= max && !/[\x00-\x1f\uD800-\uDFFF]/u.test(v);
  const id = (v: unknown): v is string =>
    text(v, 200) && !!v && !['__proto__', 'constructor', 'prototype'].includes(v);
  function location(value: unknown) {
    if (typeof value !== 'string')
      throw new ImportFailureError(
        'Enter a Kamaitachi username, numeric user ID, or profile URL.',
        'invalid',
      );
    const input = value.trim(),
      // Accept only the public profile route, never an arbitrary request target.
      // Reject encoded paths, credentials, ports, queries and fragments outright.
      profile = /^https:\/\/kamai\.tachi\.ac\/u\/([A-Za-z0-9_-]{1,64})\/?$/.exec(input),
      account = profile ? profile[1] : input;
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(account) ||
      account.toLowerCase() === 'me' ||
      (/^\d+$/.test(account) && (!integer(Number(account)) || String(Number(account)) !== account))
    )
      throw new ImportFailureError(
        'Enter a Kamaitachi username, numeric user ID, or profile URL.',
        'invalid',
      );
    return { account, url: origin + '/u/' + encodeURIComponent(account) };
  }
  function scaled(value: unknown, scale: number, max: number) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) fail();
    const result = Math.round(value * scale);
    if (Math.abs(value * scale - result) > 0.000001) fail();
    return result;
  }
  function optionalNumber(row: Record<string, unknown>, key: string) {
    const value = row[key];
    if (value == null) return null;
    if (!integer(value)) fail();
    return value;
  }
  function envelope(value: unknown) {
    if (!object(value) || value.success !== true || !object(value.body)) fail();
    return value.body;
  }
  function retryAfter(value: string | null) {
    const time = now(),
      minimum = 30000,
      maximum = 24 * 60 * 60 * 1000;
    let delay = 15 * 60 * 1000;
    if (value && value.length <= 128) {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed) && Number.isSafeInteger(Number(trimmed)))
        delay = Math.min(Number(trimmed), maximum / 1000) * 1000;
      else if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(trimmed)) {
        const date = Date.parse(trimmed);
        if (Number.isSafeInteger(date)) delay = date - time;
      }
    }
    return time + Math.max(minimum, Math.min(maximum, delay));
  }
  async function get(
    path: string,
    maximum: number,
    signal: AbortSignal,
    missing: 'user' | 'maimaidx',
  ) {
    signal.throwIfAborted();
    const { response, bytes: readBytes } = await sourceRequest(
      origin + path,
      {
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
      },
      signal,
      20000,
      'Kamaitachi could not be reached. Your saved data was kept.',
      request,
    );
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) {
        const error: Error & { retryAt: number } = Object.assign(
          new ImportFailureError(
            'Kamaitachi is limiting requests. Try again later. Your saved data was kept.',
            'rate_limited',
          ),
          { retryAt: retryAfter(response.headers.get('Retry-After')) },
        );
        throw error;
      }
      if (response.status === 404)
        throw new ImportFailureError(
          missing === 'user'
            ? 'Kamaitachi could not find that user. Check the username or profile URL.'
            : 'This Kamaitachi user has no maimai DX profile. Import maimai DX scores into Kamaitachi first, then try again.',
          'profile_missing',
        );
      throw new ImportFailureError(
        'Kamaitachi could not be reached. Your saved data was kept.',
        response.status === 401 || response.status === 403 ? 'authorization_failed' : 'unavailable',
        undefined,
        {
          reason:
            response.status === 503
              ? 'upstream_busy'
              : [401, 403].includes(response.status)
                ? 'authorization_failed'
                : 'unknown',
          stage: 'response',
        },
      );
    }
    const length = response.headers.get('Content-Length');
    if (length !== null && /^\d+$/.test(length) && Number(length) > maximum) {
      await response.body?.cancel();
      throw new DiagnosticError(
        'Kamaitachi returned an unsupported response. Your saved data was kept.',
        'oversized_response',
        'response',
      );
    }
    if (
      response.status !== 200 ||
      response.redirected ||
      (response.url && response.url !== origin + path) ||
      !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(
        response.headers.get('Content-Type') ?? '',
      ) ||
      (length !== null && (!/^\d+$/.test(length) || !integer(Number(length), maximum))) ||
      !response.body
    ) {
      await response.body?.cancel();
      fail();
    }
    const bytes = await readBytes(maximum);
    signal.throwIfAborted();
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new DiagnosticError(
        'Kamaitachi returned an unsupported response. Your saved data was kept.',
        'malformed_response',
        'response',
      );
    }
    return envelope(parsed);
  }
  async function normalize(
    profile: Record<string, unknown>,
    body: Record<string, unknown>,
    capturedAt: number,
  ) {
    if (
      !integer(capturedAt, 8640000000000000) ||
      !integer(profile.id) ||
      !text(profile.username, 200) ||
      !profile.username
    )
      fail();
    const account = String(profile.id),
      player = {
        key: 'kamaitachi:maimaidx:' + account,
        provider: 'kamaitachi',
        game: 'maimaidx',
        username: account,
        displayName: profile.username,
      };
    const arrays = ['songs', 'charts', 'pbs'] as const;
    for (const k of arrays) if (!Array.isArray(body[k]) || body[k].length > maxRows) fail();
    const songs = new Map<string, { title: string; artist: string }>();
    for (const song of body.songs as unknown[]) {
      if (
        !object(song) ||
        !id(song.id) ||
        !text(song.title) ||
        !song.title ||
        !text(song.artist) ||
        songs.has(song.id)
      )
        fail();
      songs.set(song.id, { title: song.title, artist: song.artist });
    }
    const data: Omit<PlayerDataset, 'revision'> & { revision?: string } = {
      format: 'maimai-player-data',
      schemaVersion: 1,
      player,
      charts: {},
      records: {},
      plays: {},
      snapshots: {},
      captures: {},
    };
    const charts = new Map<string, PlayerChart>(),
      usedSongs = new Set<string>(),
      records: PlayerRecord[] = [],
      pbs: Record<string, string> = {};
    for (const chart of body.charts as unknown[]) {
      if (
        !object(chart) ||
        !id(chart.chartID) ||
        charts.has(chart.chartID) ||
        chart.game !== 'maimaidx' ||
        chart.isPrimary !== true ||
        !object(chart.song) ||
        !id(chart.song.id) ||
        !object(chart.data) ||
        !text(chart.level) ||
        !text(chart.data.displayVersion)
      )
        fail();
      const song = songs.get(chart.song.id);
      if (!song || chart.song.title !== song.title || chart.song.artist !== song.artist) fail();
      const difficulty =
        typeof chart.difficulty === 'string' &&
        /^(DX )?(Basic|Advanced|Expert|Master|Re:Master)$/.exec(chart.difficulty);
      if (!difficulty) fail();
      if (
        chart.legacyChartID != null &&
        (typeof chart.legacyChartID !== 'string' || !/^[a-f0-9]{40}$/.test(chart.legacyChartID))
      )
        fail();
      // Only an explicit upstream legacy alias can enter the approved legacy map.
      const chartID =
        (chart.legacyChartID as string | null | undefined) ?? 'kamaitachi-v3:' + chart.chartID;
      if (Object.hasOwn(data.charts, chartID)) fail();
      if (chart.data.inGameID !== null && !integer(chart.data.inGameID)) fail();
      const row: PlayerChart = {
        chartID,
        songID: chart.song.id,
        ...song,
        format: difficulty[1] ? 'DX' : 'STD',
        difficulty: difficulty[2].toUpperCase(),
        level: chart.level,
        constant: scaled(chart.levelNum, 10, 20),
        displayVersion: chart.data.displayVersion,
        inGameID: chart.data.inGameID as number | null,
      };
      charts.set(chart.chartID, row);
      usedSongs.add(row.songID);
      data.charts[chartID] = row;
    }
    const usedCharts = new Set<string>();
    const lamps = ['FAILED', 'CLEAR', 'FULL COMBO', 'FULL COMBO+', 'ALL PERFECT', 'ALL PERFECT+'];
    const grades = [
      'D',
      'C',
      'B',
      'BB',
      'BBB',
      'A',
      'AA',
      'AAA',
      'S',
      'S+',
      'SS',
      'SS+',
      'SSS',
      'SSS+',
    ];
    for (const pb of body.pbs as unknown[]) {
      if (
        !object(pb) ||
        pb.userID !== profile.id ||
        pb.game !== 'maimaidx' ||
        pb.isPrimary !== true ||
        !id(pb.chartID) ||
        usedCharts.has(pb.chartID) ||
        !object(pb.scoreData) ||
        !object(pb.calculatedData)
      )
        fail();
      const chart = charts.get(pb.chartID),
        score = pb.scoreData;
      if (
        !chart ||
        pb.songID !== chart.songID ||
        !object(score.optional) ||
        !object(score.judgements) ||
        !lamps.includes(score.lamp as string) ||
        !grades.includes(score.grade as string) ||
        (pb.timeAchieved !== null && !integer(pb.timeAchieved, 8640000000000000))
      )
        fail();
      usedCharts.add(pb.chartID);
      records.push({
        chartID: chart.chartID,
        achievement: scaled(score.percent, 10000, 101),
        grade: score.grade as string,
        rate: optionalNumber(pb.calculatedData, 'rate'),
        lamp: score.lamp as string,
        sync: '',
        constant: chart.constant,
        displayVersion: chart.displayVersion,
        timeAchieved: pb.timeAchieved as number | null,
        dxScore: null,
        maxDxScore: null,
        maxCombo: optionalNumber(score.optional, 'maxCombo'),
        fast: optionalNumber(score.optional, 'fast'),
        slow: optionalNumber(score.optional, 'slow'),
        miss: optionalNumber(score.judgements, 'miss'),
        good: optionalNumber(score.judgements, 'good'),
        great: optionalNumber(score.judgements, 'great'),
        perfect: optionalNumber(score.judgements, 'perfect'),
        pcrit: optionalNumber(score.judgements, 'pcrit'),
      });
    }
    // This all-PB route promises relevant charts/songs, not a paginated slice.
    // A missing PB or dangling chart would otherwise masquerade as a full reset.
    if (usedCharts.size !== charts.size || usedSongs.size !== songs.size) fail();
    if (records.length === 0)
      throw new ImportFailureError(
        'This Kamaitachi profile has no maimai DX personal bests to import. Update its scores in Kamaitachi first, then try again.',
        'empty_scores',
      );
    for (let start = 0; start < records.length; start += 128) {
      const batch = records.slice(start, start + 128),
        ids = await Promise.all(batch.map((r) => core.digest(r)));
      batch.forEach((r, i) => {
        data.records[ids[i]] = r;
        pbs[r.chartID] = ids[i];
      });
    }
    // The endpoint returns all current primary-chart PBs, but is not a deletion
    // contract for previously saved charts (e.g. charts removed upstream).
    const snapshot = { capturedAt, phase: 'after', complete: false, versions: [], pbs },
      sid = await core.digest(snapshot);
    data.snapshots[sid] = snapshot;
    const capture = {
      capturedAt,
      sourceKind: 'kamaitachi-public-pbs',
      sourceID: player.key,
      sessionID: '',
      historyCoverage: 'none',
      playIDs: [],
      snapshotIDs: [sid],
    };
    data.captures[await core.digest(capture)] = capture;
    data.revision = await core.digest(data);
    return { data: await core.validate(data), account };
  }
  async function read(
    account: string,
    options: { signal: AbortSignal; expectedPlayer?: string | null },
  ) {
    const selected = location(account),
      controller = new AbortController(),
      abort = () => controller.abort(options.signal.reason);
    options.signal.throwIfAborted();
    options.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException('Kamaitachi request timed out.', 'TimeoutError')),
      20000,
    );
    try {
      const profile = await get(
        '/api/v1/users/' + encodeURIComponent(selected.account),
        1024 * 1024,
        controller.signal,
        'user',
      );
      if (!integer(profile.id) || !text(profile.username, 200) || !profile.username) fail();
      if (
        /^\d+$/.test(selected.account)
          ? String(profile.id) !== selected.account
          : profile.username.toLowerCase() !== selected.account.toLowerCase()
      )
        throw new ImportFailureError(
          'Kamaitachi returned an unsupported response. Your saved data was kept.',
          'account_mismatch',
        );
      if (options.expectedPlayer && options.expectedPlayer !== 'kamaitachi:maimaidx:' + profile.id)
        throw new ImportFailureError(
          'Kamaitachi returned a different player. Your saved data was kept.',
          'account_mismatch',
        );
      const body = await get(
        '/api/v1/users/' + profile.id + '/games/maimaidx/pbs/all',
        32 * 1024 * 1024,
        controller.signal,
        'maimaidx',
      );
      controller.signal.throwIfAborted();
      const result = await normalize(profile, body, now());
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      options.signal.throwIfAborted();
      if (controller.signal.aborted)
        throw transportFailure(
          error,
          'Kamaitachi could not be reached. Your saved data was kept.',
          options.signal,
          controller.signal,
        );
      if (diagnosticError(error) || importFailure(error, 'unknown') !== 'unknown') throw error;
      throw new ImportFailureError(
        error instanceof Error ? error.message : String(error),
        'invalid_response',
        undefined,
        { reason: 'normalization', stage: 'normalize' },
      );
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', abort);
    }
  }
  function matchChart(
    player: PlayerIdentity | null | undefined,
    chart: PlayerChart | undefined,
    row: ProviderRow | undefined,
    target: CatalogChart | undefined,
  ) {
    if (
      player?.provider !== 'kamaitachi' ||
      !chart ||
      !row ||
      !target ||
      row.chart_id !== target.chart_id
    )
      return false;
    const source = row.expected_source ?? target;
    return (
      ['title', 'artist', 'format', 'difficulty'].every(
        (k) => typeof source[k] === 'string' && source[k] === chart[k as keyof PlayerChart],
      ) &&
      chart.format === target.format &&
      chart.difficulty === target.difficulty
    );
  }
  return Object.freeze({ location, read, matchChart });
}
