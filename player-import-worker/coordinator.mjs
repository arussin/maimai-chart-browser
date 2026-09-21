import {DurableObject} from 'cloudflare:workers';
// Stores only transient cooldowns and a random lease, never player records.
export class ProfileLimiter extends DurableObject {
  async claim(manual) {
    return this.ctx.storage.transaction(async storage => {
      const now = Date.now(), state = await storage.get('limit');
      const retryAt = state ? Math.max(state.retryAt,state.leaseUntil,state.lastAttempt+(manual ? 30000 : 900000)) : 0;
      if (retryAt > now) return {retryAt};
      const next = {id:crypto.randomUUID(),lastAttempt:now,leaseUntil:now+45000,retryAt:0};
      await storage.put('limit',next); await storage.setAlarm(now+900000);
      return {id:next.id};
    });
  }
  async finish(id,retryAt) {
    await this.ctx.storage.transaction(async storage => {
      const state = await storage.get('limit'); if (!state || state.id !== id) return;
      state.leaseUntil = 0; state.retryAt = Number.isSafeInteger(retryAt) ? retryAt : 0;
      await storage.put('limit',state); await storage.setAlarm(Math.max(state.lastAttempt+900000,state.retryAt));
    });
  }
  async alarm() {
    await this.ctx.storage.transaction(async storage => {
      const state = await storage.get('limit'); if (!state) return;
      const until = Math.max(state.lastAttempt+900000,state.leaseUntil,state.retryAt);
      if (until > Date.now()) await storage.setAlarm(until); else await storage.delete('limit');
    });
  }
}
