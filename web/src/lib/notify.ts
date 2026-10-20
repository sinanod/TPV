export type NoticeKind = "info" | "success" | "error";

export interface Notice {
  id: number;
  kind: NoticeKind;
  text: string;
  action?: { label: string; run: () => void };
  /** Avisos con la misma clave son el mismo hecho (p. ej. la respuesta HTTP y el evento en tiempo real de un fallo de impresión) */
  key?: string;
  /** ms; 0 = hasta que se cierre a mano */
  duration: number;
}

type Listener = (notices: Notice[]) => void;

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l(notices));
}

export function subscribeNotices(listener: Listener) {
  listeners.add(listener);
  listener(notices);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissNotice(id: number) {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

export function notify(
  kind: NoticeKind,
  text: string,
  opts: { action?: Notice["action"]; duration?: number; key?: string } = {},
) {
  const notice: Notice = {
    id: nextId++,
    kind,
    text,
    action: opts.action,
    key: opts.key,
    duration: opts.duration ?? (kind === "error" ? 0 : 5000),
  };
  const existing = opts.key ? notices.find((n) => n.key === opts.key) : undefined;
  if (existing) {
    // Nos quedamos con el que permite actuar (Reintentar)
    if (existing.action && !notice.action) return;
    notices = notices.map((n) => (n === existing ? notice : n));
  } else {
    notices = [...notices, notice].slice(-5);
  }
  emit();
  if (notice.duration) setTimeout(() => dismissNotice(notice.id), notice.duration);
}

export const euros = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
