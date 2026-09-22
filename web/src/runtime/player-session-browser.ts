import type {
  ImportCoordinator
} from './import-coordinator';
import type {
  HistoryPort
} from './history';
import type {
  HandoffTransfer, SessionEvent
} from './player-session-contracts';
import type {
  StoreToken
} from '../views/player-storage';
/** Browser I/O for the session owner; no retained player data leaves this tab. */
export function createSessionBrowser(key :(name: string) => string) {
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(key('maimai-player-events'));
  } catch {
  }
  const temporary = {
    getItem :(name: string) => sessionStorage.getItem(name), setItem :(name: string, value: string) => sessionStorage.setItem(name, value), removeItem :(name: string) => sessionStorage.removeItem(name)
  };
  function notify(kind: SessionEvent, token: StoreToken | null) {
    const value = {
      kind, epoch: token?.epoch, version: token?.version
    };
    channel?.postMessage(value);
    try {
      localStorage.setItem(key('maimai-player-event'), JSON.stringify({
        ...value, id: crypto.randomUUID()
      }));
    } catch {
    }
  }
  function connect(owner: ImportCoordinator, historyPort: Pick < HistoryPort, 'replaceState' >) {
    if (channel) channel.onmessage = event => {
      void owner.receiveUpdate(event.data);
    };
    window.addEventListener('storage', event => {
      if (event.key === key('maimai-player-event')) try {
        void owner.receiveUpdate(JSON.parse(event.newValue ?? 'null'));
      } catch {
      }
    });
    const resume =() => {
      if (document.visibilityState !== 'hidden') void owner.resume();
    };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    const url = new URL(location.href), fragment = new URLSearchParams(url.hash.slice(1)), nonce = fragment.get('party-import');
    owner.setHandoffPending(! !(nonce && /^[a-f0-9-]{36}$/.test(nonce) && window.opener));
    if (nonce && /^[a-f0-9-]{36}$/.test(nonce) && window.opener) {
      fragment.delete('party-import');
      url.hash = fragment.toString();
      historyPort.replaceState(null, '', url);
      const opener: Window = window.opener, protocol = 'maimai-player-handoff/1';
      let connected = false, tries = 0;
      const announce =() => {
        if (! connected && tries ++ < 40) opener.postMessage({
          protocol, type: 'ready', nonce
        }, '*');
        else clearInterval(timer);
      };
      const timer = setInterval(announce, 500);
      window.addEventListener('message', function receive(event: MessageEvent < unknown >) {
        const value = event.data;
        if (typeof value !== 'object' || value === null || !('protocol' in value) || !('type' in value) || !('nonce' in value)) return;
        if ((event.origin !== 'null' && ! /^https?:\/\//.test(event.origin)) || connected || event.source !== opener || value.protocol !== protocol || value.type !== 'offer' || value.nonce !== nonce || ! event.ports [0]) return;
        connected = true;
        clearInterval(timer);
        window.removeEventListener('message', receive);
        const port = event.ports [0];
        port.start();
        void owner.handoff('offer' in value ? value.offer: undefined, 'stale' in value && value.stale === true, handoffTransfer(port));
      });
      announce();
    }
    void owner.ready.then(() => owner.refresh());
  }
  return {
    temporary, notify, connect
  };
}
export function handoffTransfer(port: Pick < MessagePort, 'postMessage' | 'close' | 'onmessage' >): HandoffTransfer {
  return {
    send: type => port.postMessage({
      type
    }), close :() => port.close(), read: signal => new Promise < ArrayBuffer >((resolve, reject) => {
      let finished = false;
      const finish =(error: Error | null, bytes?: ArrayBuffer) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
        port.onmessage = null;
        if (error) reject(error);
        else resolve(bytes !);
      };
      const cancel =() => finish(new DOMException('Superseded operation', 'AbortError'));
      const timeout = setTimeout(() => finish(new Error('The transfer was interrupted. Download the player file from the report and import it here.')), 45000);
      port.onmessage =(event: MessageEvent < unknown >) => {
        const value = event.data;
        if (typeof value !== 'object' || value === null || !('type' in value)) return;
        if (value.type === 'data' && 'bytes' in value && value.bytes instanceof ArrayBuffer) finish(null, value.bytes);
        else if (value.type === 'error') finish(new Error('The latest data could not be transferred. Please try again.'));
      };
      signal.addEventListener('abort', cancel, {
        once: true
      });
      if (signal.aborted) cancel();
      else port.postMessage({
        type: 'accept'
      });
    }),
  };
}
