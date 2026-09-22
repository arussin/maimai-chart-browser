import type {HistoryPort} from './history';
import type {BrowserSnapshot} from './contracts';

interface PositionPorts {
  history: Pick<HistoryPort, 'onTraversal' | 'onHashChange'>;
  playerReady: Promise<unknown>;
  linksReady: () => Promise<unknown>;
}

/** One cancellable position restoration, after dependencies that can change layout. */
export class PositionRestorer {
  private generation = 0;
  private waiting = false;

  constructor(private readonly ports: PositionPorts) {
    for (const type of ['pointerdown', 'keydown', 'input', 'focusin', 'wheel']) {
      document.addEventListener(type, event => {
        if (event.isTrusted) this.cancel();
      }, {capture: true, passive: true});
    }
    const cancelWaiting = () => {
      if (this.waiting) this.cancel();
    };
    ports.history.onTraversal(cancelWaiting);
    ports.history.onHashChange(cancelWaiting);
    window.addEventListener('maimai:navigation', cancelWaiting);
    window.addEventListener('pagehide', () => this.cancel());
  }

  cancel(): void {
    this.generation++;
    this.waiting = false;
  }

  restore(value: Pick<BrowserSnapshot, 'focus' | 'scroll'>): void {
    const generation = this.generation;
    const url = location.href;
    const current = () => generation === this.generation && url === location.href;
    const apply = () => {
      if (!current()) return;
      this.waiting = false;
      const target = value.focus ? document.getElementById(value.focus) : null;
      if (target?.isConnected && !target.hidden && target.getClientRects().length) {
        target.focus({preventScroll: true});
      }
      if (Array.isArray(value.scroll) && value.scroll.every(Number.isFinite)) scrollTo(...value.scroll);
    };
    void this.ports.playerReady.then(() => requestAnimationFrame(() => {
      if (!current()) return;
      const target = value.focus ? document.getElementById(value.focus) : null;
      const pending: Promise<unknown>[] = [];
      if (target?.matches('.chart-song-page[hidden]')) pending.push(this.ports.linksReady());
      for (const animation of document.getElementById('catalog')!.getAnimations({subtree: true})) {
        if (animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)) {
          pending.push(animation.finished.catch(() => {}));
        }
      }
      if (document.fonts.status === 'loading') pending.push(document.fonts.ready);
      if (!pending.length) {
        apply();
        return;
      }
      this.waiting = true;
      void Promise.all(pending).then(() => requestAnimationFrame(apply), () => {
        if (current()) this.waiting = false;
      });
    }));
  }
}
