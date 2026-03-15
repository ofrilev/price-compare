type Listener = (msg: { type: string; message: string }) => void;

const listeners = new Set<Listener>();

export function emit(type: string, message: string) {
  const data = { type, message };
  listeners.forEach((cb) => {
    try {
      cb(data);
    } catch {}
  });
}

export function subscribe(cb: Listener) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
