import type { TextView, LocalizedText } from './chart-card';
type Position = string | number;
export interface Passage {
  slides: {
    wait_start_us: number;
    movement_start_us: number;
    movement_end_us: number;
    geometry?: { points: [number, number][] } | null;
  }[];
  holds: { position: Position; start_us: number; end_us: number; simultaneous?: boolean }[];
  events: { time_us: number; position: Position; simultaneous?: boolean; role?: string }[];
}
/** The shared chart passage renderer has no browser-controller dependency. */
export function createPassagePreview(i18n: Pick<TextView, 'text' | 'attribute'>) {
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: LocalizedText,
    cls?: string,
  ) => {
    const node = document.createElement(tag);
    if (text !== undefined) i18n.text(node, text);
    if (cls) node.className = cls;
    return node;
  };
  function xy(pos: Position): [number, number] | null {
    if (pos === 'C') return [0, 0];
    let n: number,
      r = 1,
      offset = 0;
    if (typeof pos === 'number') n = pos;
    else if (/^[ABDE][1-8]$/.test(pos || '')) {
      n = +pos[1];
      r = 'BE'.includes(pos[0]) ? 0.55 : 1;
      offset = 'DE'.includes(pos[0]) ? -0.5 : 0;
    } else return null;
    let a = ((n - 0.5 + offset) * Math.PI) / 4;
    return [Math.sin(a) * r, -Math.cos(a) * r];
  }
  const ns = 'http://www.w3.org/2000/svg';
  function svgNode<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number>,
  ) {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) i18n.attribute(e, k, String(v));
    return e;
  }
  function field(snippet: Passage, label: string, lead = 600000) {
    const box = make('div', undefined, 'field');
    box.append(make('h4', label));
    const svg = svgNode('svg', {
      viewBox: '-1.35 -1.35 2.7 2.7',
      role: 'img',
      'aria-label': label + ' chart passage',
    });
    box.append(svg);
    const note = make('p', '', 'muted');
    box.append(note);
    function draw(t: number) {
      svg.replaceChildren();
      svg.append(
        svgNode('circle', {
          cx: 0,
          cy: 0,
          r: 1,
          fill: 'none',
          stroke: '#cfc4e8',
          'stroke-width': 0.025,
        }),
      );
      for (let n = 1; n <= 8; n++) {
        let [x, y] = xy(n)!;
        svg.append(
          svgNode('circle', {
            cx: x,
            cy: y,
            r: 0.09,
            fill: 'white',
            stroke: '#aa9dc3',
            'stroke-width': 0.012,
          }),
        );
        const tx = svgNode('text', {
          x,
          y: y + 0.036,
          'text-anchor': 'middle',
          'font-size': 0.11,
          fill: '#65577d',
        });
        i18n.text(tx, n);
        svg.append(tx);
      }
      let unknown = 0;
      for (const s of snippet.slides) {
        if (t < s.wait_start_us || t > s.movement_end_us) continue;
        if (!s.geometry) {
          unknown++;
          continue;
        }
        const points = s.geometry.points,
          waiting = t < s.movement_start_us;
        svg.append(
          svgNode('polyline', {
            points: points.map((p) => p.join(',')).join(' '),
            fill: 'none',
            stroke: waiting ? '#987500' : '#007d88',
            'stroke-width': 0.05,
            'stroke-dasharray': waiting ? '.07 .04' : 'none',
          }),
        );
        if (!waiting) {
          let u = Math.min(
            1,
            (t - s.movement_start_us) / (s.movement_end_us - s.movement_start_us),
          );
          let lengths = points
            .slice(1)
            .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
          let distance = u * lengths.reduce((a, b) => a + b, 0),
            i = 0;
          while (i < lengths.length - 1 && distance > lengths[i]) distance -= lengths[i++];
          let v = lengths[i] ? distance / lengths[i] : 0;
          let p = [
            points[i][0] + v * (points[i + 1][0] - points[i][0]),
            points[i][1] + v * (points[i + 1][1] - points[i][1]),
          ];
          svg.append(svgNode('circle', { cx: p[0], cy: p[1], r: 0.065, fill: '#007d88' }));
        }
      }
      for (const h of snippet.holds) {
        let p = xy(h.position);
        if (p && t >= h.start_us && t < h.end_us)
          svg.append(
            svgNode('circle', {
              cx: p[0],
              cy: p[1],
              r: 0.16,
              fill: 'none',
              stroke: h.simultaneous ? '#947000' : '#b55812',
              'stroke-width': 0.05,
            }),
          );
      }
      for (const e of snippet.events) {
        let dt = e.time_us - t;
        if (dt < -120000 || dt > lead) continue;
        let p = xy(e.position);
        if (!p) continue;
        let r = Math.max(0.05, Math.min(0.16, 0.16 - (dt / 600000) * 0.1));
        svg.append(
          svgNode('circle', {
            cx: p[0],
            cy: p[1],
            r,
            fill: e.simultaneous ? '#f4c430' : e.role === 'star_tap' ? '#007d88' : '#b82d75',
            stroke: e.simultaneous ? '#947000' : 'none',
            'stroke-width': 0.025,
            opacity: dt < 0 ? 0.5 : 1,
          }),
        );
      }
      i18n.text(
        note,
        (t / 1000000).toFixed(2) +
          ' s · ' +
          (unknown
            ? unknown + ' active path(s) not rendered'
            : 'Wait: dashed gold · Move: solid teal'),
      );
    }
    return { box, draw };
  }

  return field;
}
