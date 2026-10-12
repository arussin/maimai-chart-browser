// Fictional, finite action matrix. Independent expected values exercise the
// browser, compiled collector and owner reports against the same public cases.
const oauth = ['diving-fish'];
const direct = ['kamaitachi', ...oauth];
const actions = [
  ['provider_connect', oauth, true],
  ['provider_read', direct, true],
  ['provider_refresh', ['report', 'maishift', ...direct], true],
  ['provider_disconnect', oauth, false],
  ['provider_cleanup', oauth, false],
];
export const providerUsageRows = actions.flatMap(([action, details, cancellable]) =>
  ['started', 'completed', ...(cancellable ? ['cancelled'] : []), 'failed'].flatMap(outcome =>
    details.flatMap(detail => (outcome === 'failed' ? ['invalid', 'unavailable', 'storage', 'unknown'] : ['']).map(failure =>
      ({event:action + '_' + outcome, page:'charts', detail, failure, count:1}))),
  ),
);

providerUsageRows.push({event:'resource_opened',page:'charts',detail:'diving_fish',failure:'',count:1});
