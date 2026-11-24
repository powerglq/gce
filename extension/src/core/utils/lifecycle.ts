import { onBeforeUnmount } from 'vue';

type Cleanup = () => void;

/**
 * 组件级资源管理：统一登记事件监听与定时器，组件卸载时自动清理
 */
export class ResourceManager {
  private cleanups: Cleanup[] = [];

  on(
    target: EventTarget | null | undefined,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions
  ): void {
    if (!target) return;
    target.addEventListener(type, listener, options);
    this.cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  onWindow(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions): void {
    this.on(window, type, listener, options);
  }

  onDocument(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions): void {
    this.on(document, type, listener, options);
  }

  setTimeout(fn: () => void, ms: number): number {
    const id = window.setTimeout(fn, ms);
    this.cleanups.push(() => window.clearTimeout(id));
    return id;
  }

  dispose(): void {
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* 已失效则忽略 */
      }
    }
  }
}

export function createResourceManager(): ResourceManager {
  const manager = new ResourceManager();
  onBeforeUnmount(() => manager.dispose());
  return manager;
}
