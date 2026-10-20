import {DurableObject} from 'cloudflare:workers';
import {ProviderOAuthSessionCore} from './provider-oauth-session-core.mjs';
export class ProviderOAuthSession extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.core = new ProviderOAuthSessionCore(ctx.storage, env, {storageIdentity:ctx.id.toString()}); }
  fetch(request) { return this.core.fetch(request); }
  alarm() { return this.core.alarm(); }
}
