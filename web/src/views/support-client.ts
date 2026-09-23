import type SupportConfig from '../../../src/maimai_intelligence/assets/support-config.json';
export type SupportConfiguration = typeof SupportConfig & {
  apiOrigin?: string;
  returnHash?: string;
};
export type CheckoutStatus = 'open' | 'paid' | 'pending' | 'expired';
export interface CheckoutState {
  attempt: string;
  created: number;
  entry?: 'site' | 'support';
  session?: string;
  resume?: boolean;
  startedTracked?: boolean;
  successTracked?: boolean;
}
interface CheckoutResponse {
  status: CheckoutStatus;
  session?: string;
  clientSecret?: string;
}
export type SupportClient = NonNullable<ReturnType<typeof createSupportClient>>;
/** Payment-only adapter. It never reads player state or transmits navigation context. */
export function createSupportClient(ports: { supportConfig?: SupportConfiguration }) {
  /* Payment-only state shared with the return page. Never reads player storage or URLs. */

  const candidate = ports.supportConfig;
  if (
    !candidate ||
    (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) ||
    location.origin !== candidate.origin ||
    !/^pk_(test|live)_[A-Za-z0-9]+$/.test(candidate.publishableKey)
  )
    return;
  const config = candidate;
  const key = 'support.checkout.v2.' + config.project;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const clear = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* No state. */
    }
  };
  const save = (value: CheckoutState) => {
    // Redirect methods need this tab's state; do not start a payment if it cannot persist.
    sessionStorage.setItem(key, JSON.stringify(value));
  };
  const read = (): CheckoutState | null => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as CheckoutState | null;
      if (
        !value ||
        !uuid.test(value.attempt) ||
        (value.entry !== undefined && !['site', 'support'].includes(value.entry)) ||
        !Number.isFinite(value.created) ||
        value.created > Date.now() ||
        Date.now() - value.created > 23 * 3600000 ||
        (value.session && !/^cs_(test|live)_[a-zA-Z0-9]{10,200}$/.test(value.session))
      )
        return null;
      return value;
    } catch {
      return null;
    }
  };
  async function request(
    action: 'checkout' | 'status',
    value: CheckoutState,
  ): Promise<CheckoutResponse> {
    const response = await fetch((config.apiOrigin || '') + '/api/support/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        project: config.project,
        attempt: value.attempt,
        ...(value.session ? { session: value.session } : {}),
      }),
    });
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? 'Please wait a minute and try again.'
          : 'Checkout is unavailable. Please try again.',
      );
    const data = (await response.json()) as CheckoutResponse;
    if (!['open', 'paid', 'pending', 'expired'].includes(data.status))
      throw new Error('Invalid checkout response.');
    return data;
  }
  return Object.freeze({ config, read, save, clear, request });
}
