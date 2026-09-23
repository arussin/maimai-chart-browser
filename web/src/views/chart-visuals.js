/** Existing DOM behavior with explicit module dependencies. */
export function createChartVisuals(ports) {
  let visuals;
  /* Shared presentation only. Illustrations are authored examples, never chart evidence. */
  (() => {
    'use strict';
    const theme = ports.configuration.theme;
    const flowColors = Object.freeze(theme.flow_colors);
    const difficultyColors = Object.freeze(theme.difficulty_colors);
    const summaries = Object.freeze({
      'pattern.two_position_alternation': 'Switch between two buttons: A, B, A, B.',
      'pattern.same_position_repetition': 'Tap the same button several times.',
      'pattern.simultaneous_group': 'Hit two or more inputs together.',
      'pattern.same_head_slide_fan': 'One star starts more than one slide path.',
      'pattern.moving_slide_overlap': 'Two slide paths move at the same time.',
      'pattern.slide_tap_interleave': 'Tap while a slide is moving.',
      'pattern.delayed_slide_interleave': "Tap during a slide's waiting beat.",
      'pattern.connected_slide_chain': 'Follow connected sections of one slide.',
      'pattern.hold_tap_interleave': 'Keep holding while another input arrives.',
      'trait.backloaded_density': 'More inputs arrive near the end.',
      'trait.frontloaded_density': 'More inputs arrive near the beginning.',
      'trait.bursty_density': 'Short busy bursts interrupt quieter stretches.',
      'trait.steady_density': 'Input activity stays fairly even.',
      'trait.slide_occupancy': 'Slide movement fills much of the chart.',
    });
    const escape = (value) =>
      String(value).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
    const tap = (x, y) => `<circle class="pattern-example-tap" cx="${x}" cy="${y}" r="7"/>`;
    const star = (x, y) =>
      `<polygon class="pattern-example-tap" points="${[
        [0, -9],
        [3, -3],
        [9, -3],
        [4, 2],
        [6, 9],
        [0, 5],
        [-6, 9],
        [-4, 2],
        [-9, -3],
        [-3, -3],
      ]
        .map(([dx, dy]) => `${x + dx},${y + dy}`)
        .join(' ')}"/>`;
    const line = (x1, y1, x2, y2, cls = 'pattern-example-line') =>
      `<path class="${cls}" d="M${x1} ${y1}L${x2} ${y2}"/>`;
    const arrow = (x1, y1, x2, y2) =>
      line(x1, y1, x2, y2, 'pattern-example-movement') +
      `<path class="pattern-example-line" d="M${x2 - 7} ${y2 - 5}L${x2} ${y2}L${x2 - 7} ${y2 + 5}"/>`;
    const lanes = () =>
      '<text x="9" y="31">A</text><text x="9" y="61">B</text>' +
      line(30, 27, 286, 27, 'pattern-example-guide') +
      line(30, 57, 286, 57, 'pattern-example-guide');
    const timing = () =>
      '<text class="pattern-example-caption" x="286" y="86" text-anchor="end">time →</text>';
    const slide = (waitEnd = 116, start = 36, end = 276, y = 27) =>
      star(start, y) +
      line(start + 9, y, waitEnd, y, 'pattern-example-wait') +
      arrow(waitEnd, y, end, y);
    function patternSvg(id) {
      if (!Object.hasOwn(summaries, id)) return '';
      let drawing = '';
      switch (id) {
        case 'pattern.two_position_alternation':
          drawing =
            lanes() +
            [40, 86, 132, 178, 224, 270].map((x, i) => tap(x, i % 2 ? 57 : 27)).join('') +
            timing();
          break;
        case 'pattern.same_position_repetition':
          drawing =
            lanes() + [40, 86, 132, 178, 224, 270].map((x) => tap(x, 27)).join('') + timing();
          break;
        case 'pattern.simultaneous_group':
          drawing =
            lanes() +
            [65, 155, 245]
              .map((x) => line(x, 27, x, 57, 'pattern-example-together') + tap(x, 27) + tap(x, 57))
              .join('') +
            timing();
          break;
        case 'pattern.same_head_slide_fan':
          drawing =
            '<text class="pattern-example-caption" x="14" y="83">one head · two paths</text>' +
            arrow(67, 42, 266, 22) +
            arrow(67, 42, 266, 61) +
            star(60, 42);
          break;
        case 'pattern.moving_slide_overlap':
          drawing = lanes() + slide(98, 35, 260, 27) + slide(148, 85, 281, 57) + timing();
          break;
        case 'pattern.slide_tap_interleave':
          drawing = lanes() + slide() + tap(162, 57) + tap(237, 57) + timing();
          break;
        case 'pattern.delayed_slide_interleave':
          drawing = lanes() + slide(178) + tap(106, 57) + timing();
          break;
        case 'pattern.connected_slide_chain':
          drawing =
            '<text class="pattern-example-caption" x="14" y="83">one continuous path</text>' +
            '<path class="pattern-example-movement" d="M38 56L130 22L218 57L275 30"/>' +
            star(38, 56) +
            '<path class="pattern-example-line" d="M266 29L275 30L271 39"/>';
          break;
        case 'pattern.hold_tap_interleave':
          drawing =
            lanes() +
            '<rect class="pattern-example-hold" x="39" y="20" width="231" height="14" rx="7"/>' +
            tap(39, 27) +
            tap(119, 57) +
            tap(199, 57) +
            timing();
          break;
        case 'trait.slide_occupancy':
          drawing = slide(65, 35, 178, 27) + slide(173, 142, 278, 57) + timing();
          break;
        default: {
          const heights = {
            'trait.backloaded_density': [10, 12, 9, 14, 13, 19, 25, 31, 40, 44, 52, 57],
            'trait.frontloaded_density': [57, 52, 44, 40, 31, 25, 19, 13, 14, 9, 12, 10],
            'trait.bursty_density': [8, 9, 55, 51, 8, 9, 7, 57, 50, 9, 8, 10],
            'trait.steady_density': [30, 31, 29, 30, 32, 29, 31, 30, 29, 31, 30, 32],
          }[id];
          drawing =
            heights
              .map(
                (h, i) =>
                  `<rect class="pattern-example-density" x="${22 + i * 22}" y="${70 - h}" width="16" height="${h}" rx="2"/>`,
              )
              .join('') +
            '<text class="pattern-example-caption" x="22" y="86">start</text><text class="pattern-example-caption" x="280" y="86" text-anchor="end">end</text>';
        }
      }
      return `<svg class="pattern-example" viewBox="0 0 304 94" role="img" aria-label="${escape(summaries[id])} Illustrative example, not a chart excerpt."><title>${escape(summaries[id])}</title>${drawing}</svg>`;
    }
    visuals = Object.freeze({
      flowColors,
      difficultyColors,
      patternSvg,
      patternSummary: (id) => (Object.hasOwn(summaries, id) ? summaries[id] : ''),
    });
  })();

  return visuals;
}
