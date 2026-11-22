// Synthetic traffic that presents ordinary browser identities, identified by network.
// The user-agent policy in traffic-policy.mjs cannot see it. This list applies only to
// zone-scoped analytics: the account-scoped dataset the community badge reads has no
// network field. Add a network only on measured evidence; hosting networks also carry
// real people on VPNs, so a whole provider is excluded only when its traffic is not human.
export const NETWORK_POLICY = 'synthetic-hosting-networks-excluded-20261122';
export const AUTOMATION_NETWORKS = Object.freeze([
  // Tencent Cloud, Hong Kong (AS132203). November 13 to 21, 2026: about 1,000 addresses,
  // six Chrome identities in equal shares, desktop only, no referrer, home page only,
  // at a flat rate around the clock. It raised maimai.party from about 500 visits a day
  // to between 3,465 and 6,592.
  '132203',
]);
// Cloudflare exposes the network field only to zones on a paid plan. A Free zone rejects
// the whole query ("does not have access to the field 'clientasn'"), which takes the
// feed down for every site. Keep this list to zones verified to accept the filter.
export const NETWORK_FILTER_SITES = Object.freeze(['maimai.party']);

export function networkExclusions(site) {
  return NETWORK_FILTER_SITES.includes(site)
    ? AUTOMATION_NETWORKS.map(clientAsn_neq => ({ clientAsn_neq }))
    : [];
}
