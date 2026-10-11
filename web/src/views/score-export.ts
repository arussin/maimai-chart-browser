import type { TextView, LocalizedText } from '../components/chart-card';
import type { PlayerChart, PlayerDataset, PlayerRecord } from '../domain/player-data';
import { buildBest50, detectVersion, versionChoices } from '../domain/score-export';
import type { renderAchievement } from './score-export-canvas';

interface ExportPorts {
  root: HTMLElement;
  localization: TextView;
  dataset(): PlayerDataset | null;
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
  function discard() {
    generation++;
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = null;
  }
  dialog.addEventListener('close', () => {
    discard();
    activeRevision = null;
    dialog.replaceChildren();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    trigger = null;
  });
  function begin(title: string, source: HTMLElement, dataset: PlayerDataset) {
    discard();
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
    const close = make('button', 'Close');
    close.type = 'button';
    close.onclick = () => dialog.close();
    actions.append(generate, download, close);
    dialog.append(fields, status, preview, actions);
    if (!dialog.open) dialog.showModal();
    const invalidate = () => {
      discard();
      preview.hidden = download.hidden = true;
      preview.removeAttribute('src');
      download.removeAttribute('href');
      i18n.text(status, '');
    };
    async function render(create: () => Promise<HTMLCanvasElement>, filename: string) {
      invalidate();
      const ticket = generation;
      generate.disabled = true;
      i18n.text(status, 'Creating image…');
      try {
        const canvas = await create();
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(Error('PNG unavailable'))),
            'image/png',
          ),
        );
        if (ticket !== generation || !dialog.open || ports.dataset()?.revision !== dataset.revision)
          return;
        imageURL = URL.createObjectURL(blob);
        // Published pages already allow data images; keep their CSP unchanged.
        preview.src = canvas.toDataURL('image/png');
        download.href = imageURL;
        download.download = filename;
        preview.hidden = download.hidden = false;
        i18n.text(status, 'Image ready. Download it or save the preview.');
        download.focus({ preventScroll: true });
      } catch {
        if (ticket === generation)
          i18n.text(status, 'The image could not be created. Please try again.');
      } finally {
        if (ticket === generation) generate.disabled = false;
      }
    }
    return { fields, status, generate, invalidate, render };
  }
  function best50(source: HTMLElement) {
    const dataset = ports.dataset();
    if (!dataset) return;
    const ui = begin('Export Best 50', source, dataset),
      choices = versionChoices(dataset),
      detected = detectVersion(dataset),
      label = make('label', 'Record version'),
      select = make('select');
    select.id = 'player-export-version';
    select.append(i18n.option('Choose the version of your record', ''));
    for (const choice of choices)
      select.append(i18n.option(i18n.verbatim(choice.label), choice.id));
    select.value = detected || '';
    label.append(select);
    const hint = make(
      'p',
      detected
        ? 'Version detected from your imported report. You can change it below.'
        : 'Your import does not identify its version. Choose the version when these scores were recorded.',
    );
    const summary = make('div');
    summary.id = 'player-export-summary';
    ui.fields.append(
      hint,
      label,
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
    select.onchange = update;
    ui.generate.onclick = () => {
      if (!select.value) return;
      const model = buildBest50(dataset, select.value, ports.resolve);
      void ui.render(async () => {
        const renderer = await import('./score-export-canvas');
        return renderer.renderBest50(document, model, { translate, jacketURL: ports.jacketURL });
      }, 'maimai-best50.png');
    };
    update();
    select.focus();
  }
  function achievement(
    source: HTMLElement,
    chart: PlayerChart,
    record: PlayerRecord,
    recordKind: 'pb' | 'play',
  ) {
    const dataset = ports.dataset();
    if (!dataset) return;
    const ui = begin('Export achievement', source, dataset);
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
    };
    ui.generate.onclick = () =>
      void ui.render(
        async () => {
          const renderer = await import('./score-export-canvas');
          return renderer.renderAchievement(document, input, {
            translate,
            jacketURL: ports.jacketURL,
          });
        },
        'maimai-' +
          chart.title
            .replace(/[^\p{L}\p{N} _-]/gu, '')
            .slice(0, 70)
            .trim() +
          '-achievement.png',
      );
    ui.generate.focus();
  }
  return {
    best50,
    achievement,
    changed() {
      if (dialog.open && activeRevision !== ports.dataset()?.revision) dialog.close();
    },
  };
}
