# Usage and traffic measurements

The private product dashboard and Cloudflare traffic analytics answer different questions. Keep their units separate.

| Source | Meaning | Limits |
|---|---|---|
| Private usage aggregates | Received daily actions by finite page type, event and detail | No unique people, sessions, click sequences, selected filter values or search text; opt-outs and dropped batches are absent |
| Cloudflare HTTP visits | Cloudflare visit metric within the selected host/window | Repeat and automated traffic can contribute; not unique humans |
| HTTP requests | All measured requests including assets | Not page views; many JSON/asset requests can serve one interaction |
| RUM page loads | Browser beacon page loads | Different coverage from edge requests; blockers and opt-outs affect it |
| Response codes and edge timing | Network/service health | Sampled estimates can miss sparse failures; do not treat them as complete logs |

Use the rolling 30-day period for traffic comparisons, retain sampling metadata, and label partial days. Successful empty measurements may be zero; unavailable queries or unknown collection coverage are not zero.

The three query templates in cloudflare-dashboard/ require an existing authorized account and a freshly supplied filter restricting the exact public hostname, requestSource=eyeball, and start/end timestamps. They contain no credentials or saved counts. Native RUM charts need their own dataset-specific host filter and must not reuse the HTTP filter shape.

The community badge and Tidbyt traffic Worker share the identified-automation policy in [traffic-policy.mjs](../community-badge/traffic-policy.mjs). It excludes identifiable tests, monitors and crawlers using 50 user-agent patterns and two exact client names. Ordinary or unknown browser identities remain eligible, so the result is not a count of unique humans and cannot reliably remove tests that impersonate normal browsers.

Native dashboard charts labeled **Filtered** use the corresponding exclusions. On the traffic dashboard these cover visit and request totals, their trends, and visit breakdowns by country and device. The companion dashboard includes a filtered HTTP visit counter and whole-site trend. Charts labeled **All traffic** retain operational diagnostics, including errors, cache status, bandwidth and security actions. Charts labeled **Browser beacon** retain their RUM scope and are a separate measurement; neither group should be compared directly with the badge or Tidbyt visit count. The general query templates do not add automation exclusions automatically.

Compare filtered visits using the same exact hostname and start/end timestamps. The badge uses a cached rolling 30-day snapshot, while Tidbyt presents New York calendar-day buckets; the current day is partial. Native dashboard links can select a rolling 30-day window, and changing the window changes the total. Filtering analytics does not block requests or prevent search-engine indexing. No dashboard identifiers, personal-site topology or private verification snapshots are required by this guide.
