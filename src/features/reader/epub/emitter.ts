import {
  READER_EVENTS,
  type ReaderEventHandler,
  type ReaderEventName,
  type ReaderEventPayload,
} from "./types";

/** String-keyed handler, erased so the registries stay homogeneous. */
type AnyHandler = (payload: unknown) => void;

export type ReaderEmitter = {
  on<E extends ReaderEventName>(
    event: E,
    handler: ReaderEventHandler<E>,
  ): () => void;
  emit<E extends ReaderEventName>(
    event: E,
    payload: ReaderEventPayload[E],
  ): void;
  removeAll(): void;
};

/**
 * Tiny typed emitter. Deliberately not eventemitter3: unsubscribing is the
 * contract that keeps the reader StrictMode-safe (D12).
 */
export function createReaderEmitter(): ReaderEmitter {
  const handlers: Record<ReaderEventName, Set<AnyHandler>> = {
    selected: new Set(),
    markClicked: new Set(),
    pointerDown: new Set(),
    relocated: new Set(),
    displayed: new Set(),
    scrolled: new Set(),
    boundary: new Set(),
    imageClicked: new Set(),
  };

  return {
    on(event, handler) {
      const set = handlers[event];
      const erased = handler as unknown as AnyHandler;
      set.add(erased);
      return () => {
        set.delete(erased);
      };
    },
    emit(event, payload) {
      for (const handler of Array.from(handlers[event])) handler(payload);
    },
    removeAll() {
      for (const name of READER_EVENTS) handlers[name].clear();
    },
  };
}
