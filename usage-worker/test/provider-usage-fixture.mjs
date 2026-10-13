// Fictional, finite action matrix. Independent expected values exercise the
// browser, compiled collector and owner reports against the same public cases.
const oauth = ['diving-fish', 'lxns'];
const direct = ['kamaitachi', ...oauth];
export const fileImportMethods = ['file:mai-tools', 'file:dxrating', 'file:tomomai', 'file:jietng', 'file:aqua', 'file:tachi'];
const failures = ['invalid', 'unavailable', 'storage', 'unknown', 'popup_blocked',
  'authorization_failed', 'timeout', 'network', 'rate_limited', 'connection_expired',
  'agreement_required', 'profile_missing', 'empty_scores', 'invalid_response',
  'account_mismatch', 'cleanup_required'];
const actions = [
  ['provider_connect', oauth, true],
  ['provider_read', direct, true],
  ['provider_refresh', ['report', 'maishift', ...direct], true],
  ['provider_disconnect', oauth, false],
  ['provider_cleanup', oauth, false],
];
export const providerUsageRows = actions.flatMap(([action, details, cancellable]) =>
  ['started', 'completed', ...(cancellable ? ['cancelled'] : []), 'failed'].flatMap(outcome =>
    details.flatMap(detail => (outcome === 'failed' ? failures : ['']).map(failure =>
      ({event:action + '_' + outcome, page:'charts', detail, failure, count:1}))),
  ),
);

for(const outcome of ['started','previewed','confirmed','completed','cancelled','failed'])
 for(const detail of ['file','report','maishift',...direct,...fileImportMethods])
  for(const failure of outcome==='failed'?failures:[''])
   providerUsageRows.push({event:'import_'+outcome,page:'charts',detail,failure,count:1});

providerUsageRows.push({event:'resource_opened',page:'charts',detail:'diving_fish',failure:'',count:1});
providerUsageRows.push({event:'resource_opened',page:'charts',detail:'lxns',failure:'',count:1});
