/** Owner-report presentation of finite counters; never accept application text here. */
export const actionLabels = Object.freeze({
  score_export_opened: 'Image exporter opened',
  score_export_option_changed: 'Export option changed',
  score_export_started: 'Create image requested',
  score_export_completed: 'Image ready',
  score_export_failed: 'Image creation failed',
  score_export_download_clicked: 'PNG download clicked',
  best50: 'Best 50 image',
  achievement_pb: 'Personal best image',
  achievement_play: 'Recorded play image',
  clear: 'Forget / clear player data',
});
export const actionLabel = value => actionLabels[value] || (value ? value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) : '—');
export const isScoreExport = event => event.startsWith('score_export_');
