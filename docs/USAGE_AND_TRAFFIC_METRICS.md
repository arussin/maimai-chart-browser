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

The community badge additionally excludes the two exact known monitor user agents in its source; the general traffic templates do not. Badge and native-dashboard totals can therefore differ. No dashboard identifiers, personal-site topology or private verification snapshots are required by this guide.
