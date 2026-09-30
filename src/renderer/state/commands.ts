import type { MenuCommand } from '../../shared/api';

type Listener = (cmd: MenuCommand) => boolean | void;

/** Menu/keyboard commands. The most recently registered listener runs first; returning true stops propagation. */
class CommandBus {
  private listeners: Listener[] = [];
  on(l: Listener): () => void {
    this.listeners.unshift(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }
  emit(cmd: MenuCommand): void {
    for (const l of [...this.listeners]) if (l(cmd) === true) return;
  }
}

export const commandBus = new CommandBus();
