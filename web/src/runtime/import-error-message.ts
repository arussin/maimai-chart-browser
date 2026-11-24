import { diagnosticError } from './diagnostic-error';
import { importFailure } from './import-failure';

/** Fixed, local copy only. Never render provider text, field paths or player values. */
export function importErrorMessage(
  error: unknown,
  context: 'file' | 'source' | 'storage' = 'source',
): string {
  const diagnostic = diagnosticError(error);
  const failure = importFailure(error);
  if (context === 'storage' || failure === 'storage')
    return 'Your browser could not save these scores. Free some device storage or import without remembering, then try again.';
  if (diagnostic?.reason === 'region_mismatch')
    return 'The export does not match the selected game region. Choose the region used for this export and try again.';
  if (context === 'file') {
    if (diagnostic?.reason === 'oversized_response')
      return 'This file is too large to import. Choose a smaller export from the same source.';
    if (diagnostic?.stage === 'decode' || diagnostic?.reason === 'record_shape')
      return 'This file was not recognised for the selected source. Choose the matching file method and a fresh JSON or gzip export, then try again.';
    return 'The file contains scores Party could not read safely. Export it again from the selected source and check the game region. If it still fails, keep the export for a bug report.';
  }
  if (failure === 'profile_missing' || failure === 'empty_scores')
    return 'No readable scores were found. Check the profile name and game region, sync your scores on the tracker, and make the profile public if required. Then try again.';
  if (failure === 'rate_limited')
    return 'The score service received too many requests. Wait a few minutes before trying again.';
  if (failure === 'authorization_failed' || (error instanceof Error && error.name === 'AbortError'))
    return 'Sign-in was cancelled or permission was not granted. Start Connect again and approve read-only access to your scores.';
  if (failure === 'popup_blocked') return 'Allow pop-ups to connect your account, then try again.';
  if (failure === 'connection_expired')
    return 'Your connection has expired. Connect your account again to refresh your scores.';
  if (failure === 'agreement_required')
    return 'Open Diving-Fish, accept its tracker agreement, and confirm your scores are visible. Then try again.';
  if (
    failure === 'invalid_response' ||
    diagnostic?.reason === 'normalization' ||
    diagnostic?.reason.startsWith('record_')
  )
    return 'The score service returned a format Party cannot read safely. Try again later or use another import method. Your saved scores have been kept.';
  if (failure === 'network' || failure === 'timeout')
    return 'The score service could not be reached in time. Check your connection and try again in a few minutes.';
  return 'These scores could not be imported. Check the source and game region, then try again or choose another import method. Your saved scores have been kept.';
}
