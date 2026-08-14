export interface SiteAdapter {
  id: string;
  label: string;
  getProgress(): number;
  setProgress(progress: number): void;
  isReady(): boolean;
  detail?: string;
}

export function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function progressFromElement(el: Element | null): number {
  if (!el) return 0;
  const scrollEl = el as HTMLElement;
  const max = scrollEl.scrollHeight - scrollEl.clientHeight;
  if (max <= 0) return 0;
  return clamp01(scrollEl.scrollTop / max);
}

export function setProgressOnElement(el: Element | null, progress: number): void {
  if (!el) return;
  const scrollEl = el as HTMLElement;
  const max = scrollEl.scrollHeight - scrollEl.clientHeight;
  if (max <= 0) return;
  scrollEl.scrollTop = clamp01(progress) * max;
}

export function pickScrollContainer(
  candidates: Array<Element | null | undefined>,
): HTMLElement | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const el = candidate as HTMLElement;
    if (el.scrollHeight > el.clientHeight + 4) {
      return el;
    }
  }
  return null;
}
