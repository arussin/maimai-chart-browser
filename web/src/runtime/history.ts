import type { NavigationEntry } from './contracts';

/** The only adapter allowed to write history or listen to native route events. */
export class HistoryPort {
  get state(): NavigationEntry {
    return history.state ?? {};
  }

  replaceState(state: NavigationEntry | null, _title: string, url?: string | URL | null): void {
    history.replaceState(state, '', url);
  }

  pushState(state: NavigationEntry | null, _title: string, url?: string | URL | null): void {
    history.pushState(state, '', url);
  }

  replace(state: NavigationEntry, url: string | URL = location.href): void {
    this.replaceState(state, '', url);
  }

  push(state: NavigationEntry, url: string | URL): void {
    this.pushState(state, '', url);
  }

  changeQuery(change: (query: URLSearchParams) => void): void {
    const url = new URL(location.href);
    change(url.searchParams);
    this.replace(this.state, url);
  }

  onTraversal(callback: () => void): () => void {
    window.addEventListener('popstate', callback);
    return () => window.removeEventListener('popstate', callback);
  }

  onHashChange(callback: () => void): () => void {
    window.addEventListener('hashchange', callback);
    return () => window.removeEventListener('hashchange', callback);
  }
}

export const historyPort = new HistoryPort();
