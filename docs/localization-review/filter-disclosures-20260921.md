# Filter disclosure copy review — 2026-09-21

Reviewer: Codex. Method: AI review of changed strings against the live filter UI,
existing terminology decisions, and all three language catalogs. This is not
native-speaker certification. No new official game terminology is introduced.

| English | Simplified Chinese | Korean | Japanese |
| --- | --- | --- | --- |
| Filters | 筛选 | 필터 | フィルター |
| Expand | 展开 | 펼치기 | 展開 |
| Collapse | 收起 | 접기 | 折りたたむ |
| Click to expand | 点击展开 | 클릭하여 펼치기 | クリックして展開 |
| Click to collapse | 点击收起 | 클릭하여 접기 | クリックして折りたたむ |
| Clear | 清除 | 지우기 | クリア |
| Clear filters | 清除筛选 | 필터 지우기 | フィルターをクリア |
| No filters selected | 未选择筛选条件 | 선택한 필터 없음 | フィルター未選択 |
| Active personal filters | 当前个人成绩筛选 | 적용 중인 개인 기록 필터 | 適用中の個人成績フィルター |
| Search: {0} | 搜索：{0} | 검색: {0} | 検索：{0} |
| Enable multi-sorting | 启用多条件排序 | 다중 기준 정렬 사용 | 複数条件で並べ替え |

The multi-sorting checkbox enables multiple sorting criteria, rather than
preserving a saved sort or sorting multiple songs in a batch. The Japanese
checkbox uses a concise action phrase appropriate for this control. Clear resets
filter selections, not imported player records. Search placeholders preserve the
user's query literally. Existing grade, combo, difficulty, and version labels
remain unchanged.

The Japanese collapse label is longer than its former 52-pixel column. The
heading now reserves 60 pixels, permits text wrapping, and constrains its count
column. Regression coverage checks actual text bounds, matching action positions,
page reflow, both disclosure states, active and empty filters, all four languages,
and 280/320/390/1280-pixel viewports in Chromium and WebKit.
