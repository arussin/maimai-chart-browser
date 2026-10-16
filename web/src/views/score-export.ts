import type { TextView, LocalizedText } from '../components/chart-card';
import { createVersionPicker } from '../components/version-picker';
import type { PlayerChart, PlayerDataset, PlayerRecord } from '../domain/player-data';
import {
  buildBest50,
  detectVersion,
  versionChoices,
  type ExportPlayerRating,
} from '../domain/score-export';
import type { renderAchievement } from './score-export-canvas';
import { defaultScoreExportPartner, scoreExportPartners } from './score-export-partners';
import type { ScoreExportPreferences } from '../runtime/score-export-preferences';
import type { ScoreExportKind, ScoreExportUsageArguments } from '../usage-contract';
import type { DiagnosticSink, Reason, Outcome } from '../diagnostic-contract';
import { beginDiagnostic } from '../runtime/operation-diagnostics';
import { DiagnosticError } from '../runtime/diagnostic-error';

interface ExportPorts {
  root: HTMLElement;
  localization: TextView;
  preferences: ScoreExportPreferences;
  usage(...args: ScoreExportUsageArguments): void;
  diagnose?: DiagnosticSink;
  dataset(): PlayerDataset | null;
  playerRating?(): ExportPlayerRating | null;
  resolve(
    chart: PlayerChart,
    record: PlayerRecord,
  ):
    | {
        canonicalChartID?: string;
        displayVersion?: string;
        versionEvidence?: 'unqualified';
        alias?: boolean;
      }
    | undefined;
  jacketURL(chart: PlayerChart): string | undefined;
  versionLogo(name: string): HTMLElement | undefined;
  versionLogoURL?(version: string): string | undefined;
  artworkURL?(key: string): string | undefined;
}

/** Local image generation owns no player state and never writes back to an import. */
export function createScoreExporter(ports: ExportPorts) {
  const document = ports.root.ownerDocument,
    i18n = ports.localization,
    dialog = document.createElement('dialog');
  dialog.id = 'player-export-dialog';
  dialog.className = 'player-dialog player-export-dialog';
  dialog.setAttribute('aria-labelledby', 'player-export-title');
  ports.root.append(dialog);
  let trigger: HTMLElement | null = null,
    imageURL: string | null = null,
    generation = 0,
    activeRevision: string | null = null;
  let disposeFields = () => {};
  let rendering: ReturnType<typeof beginDiagnostic> | null = null;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: LocalizedText) => {
    const node = document.createElement(tag);
    if (text !== undefined) i18n.text(node, text);
    return node;
  };
  const translate = (key: string, values: readonly (string | number)[] = []) => {
    const node = make(
      'span',
      i18n.message(
        key,
        values.map((value) => i18n.verbatim(value)),
      ),
    );
    return node.textContent || '';
  };
  function discard(outcome: Outcome = 'superseded') {
    rendering?.finish(outcome);
    rendering = null;
    generation++;
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = null;
  }
  dialog.addEventListener('close', () => {
    discard('cancelled');
    disposeFields();
    disposeFields = () => {};
    activeRevision = null;
    dialog.replaceChildren();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    trigger = null;
  });
  function begin(
    title: string,
    source: HTMLElement,
    dataset: PlayerDataset,
    kind: ScoreExportKind,
  ) {
    discard();
    disposeFields();
    disposeFields = () => {};
    trigger = source;
    activeRevision = dataset.revision;
    dialog.replaceChildren();
    const heading = make('h2', title);
    heading.id = 'player-export-title';
    const intro = make('p', 'Create an image on this device to save or share.');
    intro.id = 'player-export-description';
    dialog.setAttribute('aria-describedby', intro.id);
    dialog.append(heading, intro);
    const fields = make('div');
    fields.className = 'player-export-fields';
    const status = make('p');
    status.id = 'player-export-status';
    status.setAttribute('role', 'status');
    const preview = make('img');
    preview.id = 'player-export-preview';
    preview.hidden = true;
    i18n.attribute(preview, 'alt', 'Export image preview');
    const actions = make('div');
    actions.className = 'player-export-actions';
    const generate = make('button', 'Create image');
    generate.type = 'button';
    generate.id = 'player-export-generate';
    const download = make('a', 'Download PNG');
    download.id = 'player-export-download';
    download.hidden = true;
    download.onclick = () => {
      if (!download.hidden && dialog.open && ports.dataset()?.revision === dataset.revision)
        ports.usage('score_export_download_clicked', kind);
    };
    const close = make('button', 'Close');
    close.type = 'button';
    close.onclick = () => dialog.close();
    actions.append(generate, download, close);
    dialog.append(fields, status, preview, actions);
    if (!dialog.open) dialog.showModal();
    ports.usage('score_export_opened', kind);
    const invalidate = () => {
      discard();
      preview.hidden = download.hidden = true;
      preview.removeAttribute('src');
      download.removeAttribute('href');
      i18n.text(status, '');
    };
    async function render(
      create: (fallback: () => void) => Promise<HTMLCanvasElement>,
      filename: string,
    ) {
      invalidate();
      const ticket = generation;
      generate.disabled = true;
      i18n.text(status, 'Creating image…');
      ports.usage('score_export_started', kind);
      const operation = beginDiagnostic(ports.diagnose, 'image_export', kind, 'manual');
      rendering = operation;
      let fallback = false,
        failure: Reason = 'unknown';
      operation.stage('canvas');
      const current = () =>
        ticket === generation && dialog.open && ports.dataset()?.revision === dataset.revision;
      try {
        const canvas = await create(() => {
          fallback = true;
        });
        if (!current()) {
          operation.finish('superseded');
          return;
        }
        operation.stage('encode');
        failure = 'png_encoding';
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(Error('PNG unavailable'))),
            'image/png',
          ),
        );
        if (!current()) {
          operation.finish('superseded');
          return;
        }
        operation.stage('preview');
        failure = 'preview_preparation';
        imageURL = URL.createObjectURL(blob);
        // Published pages already allow data images; keep their CSP unchanged.
        preview.src = canvas.toDataURL('image/png');
        if (preview.decode) await preview.decode();
        if (!current()) {
          operation.finish('superseded');
          return;
        }
        download.href = imageURL;
        download.download = filename;
        preview.hidden = download.hidden = false;
        i18n.text(status, 'Image ready. Download it or save the preview.');
        download.focus({ preventScroll: true });
        ports.usage('score_export_completed', kind);
        operation.finish(fallback ? 'degraded' : 'success', fallback ? 'artwork_failed' : 'none');
      } catch (error) {
        if (current()) {
          operation.fail(error, failure);
          if (imageURL) URL.revokeObjectURL(imageURL);
          imageURL = null;
          i18n.text(status, 'The image could not be created. Please try again.');
          ports.usage('score_export_failed', kind);
        } else operation.finish('superseded');
      } finally {
        if (rendering === operation) rendering = null;
        if (ticket === generation) generate.disabled = false;
      }
    }
    return { fields, status, generate, invalidate, render };
  }
  function best50(source: HTMLElement) {
    const dataset = ports.dataset();
    if (!dataset) return;
    const ui = begin('Export Best 50', source, dataset, 'best50'),
      choices = versionChoices(dataset),
      detected = detectVersion(dataset),
      saved = ports.preferences.read().versionID,
      selected = choices.some((choice) => choice.id === saved) ? saved : detected,
      picker = createVersionPicker({
        document,
        localization: i18n,
        choices,
        selected,
        logo: ports.versionLogo,
      }),
      select = picker.select;
    disposeFields = picker.destroy;
    const hint = make(
      'p',
      saved && selected === saved
        ? 'Using your saved version choice. Check that it matches this record.'
        : detected
          ? 'Version detected from your imported report. You can change it below.'
          : 'Your import does not identify its version. Choose the version when these scores were recorded.',
    );
    const summary = make('div');
    summary.id = 'player-export-summary';
    ui.fields.append(
      hint,
      picker.root,
      make(
        'p',
        'Version selects the New 15 pool. Imported ratings and constants are kept; choosing a different version does not recreate historical scores.',
      ),
      summary,
    );
    function update() {
      ui.invalidate();
      summary.replaceChildren();
      ui.generate.disabled = !select.value;
      if (!select.value) return;
      if (!choices.find((choice) => choice.id === select.value)?.supportsBest50) {
        summary.append(
          make('p', 'Best 50 began with Splash PLUS. Earlier rating formats are not supported.'),
        );
        ui.generate.disabled = true;
        return;
      }
      const model = buildBest50(dataset!, select.value, ports.resolve);
      summary.append(
        make(
          'p',
          i18n.message('Old 35: {0}/35 · New 15: {1}/15 · Rating: {2}', [
            model.old.length,
            model.new.length,
            model.totalRating,
          ]),
        ),
      );
      for (const warning of model.warnings) summary.append(make('p', warning));
      if (model.excluded.total)
        summary.append(
          make(
            'p',
            i18n.message(
              '{0} records excluded because their data cannot be used for this version.',
              [model.excluded.total],
            ),
          ),
        );
      ui.generate.disabled = model.old.length + model.new.length === 0;
    }
    let previousVersion = select.value;
    select.onchange = () => {
      if (select.value === previousVersion) return;
      previousVersion = select.value;
      ports.preferences.setVersion(select.value);
      ports.usage('score_export_option_changed', 'version');
      i18n.text(
        hint,
        ports.preferences.read().versionID === select.value
          ? 'Using your saved version choice. Check that it matches this record.'
          : 'The game version was selected manually.',
      );
      update();
    };
    ui.generate.onclick = () => {
      if (!choices.find((choice) => choice.id === select.value)?.supportsBest50) return;
      const model = buildBest50(dataset, select.value, ports.resolve);
      void ui.render(async (artworkFallback) => {
        const renderer = await loadRenderer();
        return renderer.renderBest50(document, model, {
          translate,
          jacketURL: ports.jacketURL,
          versionLogoURL: ports.versionLogoURL,
          artworkURL: ports.artworkURL,
          artworkFallback,
        });
      }, 'maimai-best50.png');
    };
    update();
    picker.button.focus();
  }
  function achievement(
    source: HTMLElement,
    chart: PlayerChart,
    record: PlayerRecord,
    recordKind: 'pb' | 'play',
  ) {
    const dataset = ports.dataset();
    if (!dataset) return;
    const ui = begin(
      'Export achievement',
      source,
      dataset,
      recordKind === 'pb' ? 'achievement_pb' : 'achievement_play',
    );
    ui.fields.append(
      make('p', i18n.verbatim(chart.title)),
      make(
        'p',
        recordKind === 'pb'
          ? 'Personal bests can combine achievements from different plays.'
          : 'This image uses one recorded play.',
      ),
    );
    const input: Parameters<typeof renderAchievement>[1] = {
      chart,
      record,
      playerName: dataset.player.displayName,
      recordKind,
      playerRating: ports.playerRating?.() ?? null,
      partnerKey: ports.preferences.read().partnerKey,
    };
    const partnerLabel = make('label', 'Partner illustration'),
      partner = make('select');
    partner.id = 'player-export-partner';
    partnerLabel.htmlFor = partner.id;
    partner.append(i18n.option('None', 'none'));
    for (const choice of scoreExportPartners)
      partner.append(i18n.option(i18n.verbatim(choice.name), choice.key));
    partner.value = input.partnerKey ?? defaultScoreExportPartner;
    partner.onchange = () => {
      const next =
        scoreExportPartners.find((choice) => choice.key === partner.value)?.key ?? 'none';
      if (next === input.partnerKey) return;
      input.partnerKey = next;
      ports.preferences.setPartner(input.partnerKey);
      ports.usage('score_export_option_changed', 'partner');
      ui.invalidate();
      ui.generate.disabled = false;
    };
    ui.fields.append(partnerLabel, partner);
    ui.generate.onclick = () => {
      const selectedInput = { ...input };
      void ui.render(
        async (artworkFallback) => {
          const renderer = await loadRenderer();
          return renderer.renderAchievement(document, selectedInput, {
            translate,
            jacketURL: ports.jacketURL,
            versionLogoURL: ports.versionLogoURL,
            artworkURL: ports.artworkURL,
            artworkFallback,
          });
        },
        'maimai-' +
          chart.title
            .replace(/[^\p{L}\p{N} _-]/gu, '')
            .slice(0, 70)
            .trim() +
          '-achievement.png',
      );
    };
    ui.generate.focus();
  }
  return {
    best50,
    achievement,
    changed() {
      if (dialog.open && activeRevision !== ports.dataset()?.revision) {
        rendering?.finish('superseded');
        dialog.close();
      }
    },
  };
}
async function loadRenderer() {
  try {
    return await import('./score-export-canvas');
  } catch {
    throw new DiagnosticError(
      'The image could not be created. Please try again.',
      'renderer_module',
      'renderer',
    );
  }
}
