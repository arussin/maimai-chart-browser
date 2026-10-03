import type { PersonalFilters } from '../runtime/browser-state';
import type { TextView, LocalizedText } from '../components/chart-card';
import type { UsageAPI } from '../usage';
type RangeKey = 'min' | 'max' | 'rateMin' | 'rateMax';
interface RangePorts {
  localization: Pick<TextView, 'text' | 'attribute'> & { translate(value: string): string };
  maishift: { grade(achievement: number): string };
  usage?: Pick<UsageAPI, 'emit'>;
}
/** Grade stops and exact inputs edit the same supplied personal filter state. */
export function createPlayerRanges(ports: RangePorts) {
  /* Grade stops and exact inputs share the personal filter state. */
  const stops = [0, 50, 60, 70, 75, 80, 90, 94, 97, 98, 99, 99.5, 100, 100.5, 101];
  const text = (node: Node, value: LocalizedText) => ports.localization.text(node, value),
    format = (value: number) => String(Number(value.toFixed(4)));
  const toPosition = (value: number) => {
    if (value <= 0) return 0;
    if (value >= 101) return stops.length - 1;
    const upper = stops.findIndex((stop) => stop >= value),
      lower = upper - 1;
    return lower + (value - stops[lower]) / (stops[upper] - stops[lower]);
  };
  return (
    host: HTMLElement,
    state: Pick<PersonalFilters, RangeKey>,
    onchange: () => void,
    getRatings: () => Iterable<unknown>,
  ) => {
    const document = host.ownerDocument,
      window = document.defaultView!;
    let cards: { sync(): void; root: HTMLElement }[] = [];
    let pending = false;
    let ratings: [number, number] | null = null;
    function queue() {
      if (!pending) {
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          cards.forEach((card) => card.sync());
        });
      }
    }
    function updateData() {
      let lo = Infinity,
        hi = -Infinity;
      for (const rating of getRatings()) {
        if (typeof rating === 'number' && Number.isFinite(rating)) {
          lo = Math.min(lo, rating);
          hi = Math.max(hi, rating);
        }
      }
      ratings = lo === Infinity ? null : [lo, hi];
      queue();
    }
    function card(kind: 'achievement' | 'rating', keys: [RangeKey, RangeKey], title: string) {
      const fields = keys.map((key) => {
        const field = document.createElement('input');
        field.type = 'number';
        field.min = '0';
        if (kind === 'achievement') field.max = '101';
        field.id = 'personal-' + key;
        field.value = state[key];
        field.oninput = () => {
          state[key] = field.value;
          ports.usage?.emit('filter_first_used', undefined, kind);
          onchange();
        };
        return field;
      });
      const root = document.createElement('section');
      root.className = 'personal-range-card';
      root.dataset.range = kind;
      const heading = document.createElement('div');
      heading.className = 'personal-range-heading';
      const name = document.createElement('h3');
      name.id = 'personal-range-' + kind;
      text(name, title);
      root.setAttribute('aria-labelledby', name.id);
      const reset = document.createElement('button');
      reset.type = 'button';
      text(reset, 'Clear');
      ports.localization.attribute(
        reset,
        'aria-label',
        kind === 'achievement' ? 'Remove Achievement filter' : 'Remove Chart rating filter',
      );
      heading.append(name, reset);
      root.append(heading);
      const values = document.createElement('div');
      values.className = 'personal-range-values';
      fields.forEach((field, index) => {
        const label = document.createElement('label'),
          inputWrap = document.createElement('span');
        text(label, index ? 'To' : 'From');
        inputWrap.className = 'personal-range-input';
        ports.localization.attribute(
          field,
          'aria-label',
          kind === 'achievement'
            ? index
              ? 'Achievement to %'
              : 'Achievement from %'
            : index
              ? 'Chart rating to'
              : 'Chart rating from',
        );
        field.inputMode = kind === 'achievement' ? 'decimal' : 'numeric';
        field.step = kind === 'achievement' ? '0.0001' : '1';
        inputWrap.append(field);
        if (kind === 'achievement') {
          const unit = document.createElement('span');
          unit.textContent = '%';
          unit.setAttribute('aria-hidden', 'true');
          inputWrap.append(unit);
        }
        label.append(inputWrap);
        values.append(label);
        field.addEventListener('input', queue);
      });
      root.append(values);
      const track = document.createElement('div');
      track.className = 'personal-range-track';
      const fill = document.createElement('span');
      fill.className = 'personal-range-fill';
      fill.setAttribute('aria-hidden', 'true');
      track.append(fill);
      if (kind === 'achievement')
        for (let i = 0; i < stops.length; i++) {
          const tick = document.createElement('i');
          tick.style.left = (100 * i) / (stops.length - 1) + '%';
          tick.setAttribute('aria-hidden', 'true');
          track.append(tick);
        }
      const sliders = fields.map((field, index) => {
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'personal-range-slider';
        slider.id = 'personal-' + keys[index] + '-slider';
        slider.step = kind === 'achievement' ? 'any' : '1';
        ports.localization.attribute(
          slider,
          'aria-label',
          kind === 'achievement'
            ? index
              ? 'Achievement to %'
              : 'Achievement from %'
            : index
              ? 'Chart rating to'
              : 'Chart rating from',
        );
        function apply(value: number) {
          const domain = kind === 'achievement' ? [0, 101] : ratings;
          if (!domain) return;
          const other =
            fields[1 - index].value === '' ? domain[1 - index] : Number(fields[1 - index].value);
          value = Math.max(
            domain[0],
            Math.min(domain[1], index ? Math.max(value, other) : Math.min(value, other)),
          );
          field.value = format(value);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          sync();
        }
        slider.addEventListener('input', () =>
          apply(
            kind === 'achievement' ? stops[Math.round(Number(slider.value))] : Number(slider.value),
          ),
        );
        slider.addEventListener('keydown', (event) => {
          const domain = kind === 'achievement' ? [0, 101] : ratings;
          if (!domain) return;
          const value = field.value === '' ? domain[index] : Number(field.value),
            forward = ['ArrowRight', 'ArrowUp', 'PageUp'].includes(event.key),
            back = ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key);
          if (!forward && !back && !['Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? domain[0]
              : event.key === 'End'
                ? domain[1]
                : kind === 'achievement'
                  ? forward
                    ? stops.find((stop) => stop > value)
                    : stops.findLast((stop) => stop < value)
                  : value + (forward ? 1 : -1) * (event.key.startsWith('Page') ? 10 : 1);
          apply(next ?? value);
        });
        track.append(slider);
        return slider;
      });
      root.append(track);
      const axis = document.createElement('div');
      axis.className = 'personal-range-axis';
      axis.setAttribute('aria-hidden', 'true');
      const low = document.createElement('span'),
        high = document.createElement('span');
      axis.append(low, high);
      if (kind === 'achievement') {
        const s = document.createElement('span');
        s.className = 'personal-range-grade-marker';
        s.style.left = (100 * stops.indexOf(97)) / (stops.length - 1) + '%';
        s.textContent = 'S · 97%';
        axis.append(s);
      }
      const hint = document.createElement('p');
      hint.className = 'personal-range-hint';
      hint.id = 'personal-range-' + kind + '-hint';
      sliders.forEach((slider) => slider.setAttribute('aria-describedby', hint.id));
      root.append(axis, hint);
      host.append(root);
      reset.onclick = () => {
        keys.forEach((key) => (state[key] = ''));
        onchange();
        sync();
      };
      function sync() {
        const domain = kind === 'achievement' ? [0, 101] : ratings,
          empty = !domain,
          fixed = !!domain && domain[0] === domain[1];
        const positions: number[] = [];
        fields.forEach((field, index) => {
          field.value = state[keys[index]];
          field.placeholder = empty ? '—' : format(domain![index]);
          field.disabled = empty;
          const value = field.value === '' ? (domain?.[index] ?? 0) : Number(field.value),
            slider = sliders[index];
          slider.min = kind === 'achievement' ? '0' : String(domain?.[0] ?? 0);
          slider.max = kind === 'achievement' ? String(stops.length - 1) : String(domain?.[1] ?? 1);
          slider.disabled = empty || fixed;
          slider.value = String(kind === 'achievement' ? toPosition(value) : value);
          const grade =
            kind === 'achievement' ? ports.maishift.grade(Math.round(value * 10000)) : '';
          slider.setAttribute(
            'aria-valuetext',
            (field.value === '' ? ports.localization.translate('Any') + ' · ' : '') +
              format(value) +
              (kind === 'achievement' ? '% · ' + grade : ' RT'),
          );
          positions.push(
            kind === 'achievement'
              ? (100 * toPosition(value)) / (stops.length - 1)
              : empty || fixed
                ? index * 100
                : Math.max(
                    0,
                    Math.min(100, (100 * (value - domain![0])) / (domain![1] - domain![0])),
                  ),
          );
        });
        track.style.setProperty('--range-start', positions[0] + '%');
        track.style.setProperty('--range-end', positions[1] + '%');
        root.classList.toggle('range-unavailable', empty || fixed);
        low.textContent = empty ? '—' : format(domain[0]) + (kind === 'achievement' ? '%' : '');
        high.textContent = empty ? '—' : format(domain[1]) + (kind === 'achievement' ? '%' : '');
        text(
          hint,
          empty
            ? 'No known chart ratings in this import.'
            : kind === 'achievement'
              ? 'Drag by grade or enter an exact %.'
              : 'Based on your imported chart ratings.',
        );
        reset.disabled = fields.every((field) => field.value === '');
      }
      sync();
      return { sync, root };
    }
    cards = [
      card('achievement', ['min', 'max'], 'Achievement'),
      card('rating', ['rateMin', 'rateMax'], 'Chart rating'),
    ];
    const sections = document.createElement('div');
    sections.className = 'personal-range-sections';
    sections.append(...cards.map((card) => card.root));
    host.append(sections);
    updateData();
    window.addEventListener('maimai-language-change', queue);
    return { updateData, sync: () => cards.forEach((card) => card.sync()) };
  };
}
