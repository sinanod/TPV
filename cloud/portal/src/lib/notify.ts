export type Toast = { id: number; kind: "ok" | "error"; message: string };

let listener: (toast: Toast) => void = () => {};
let nextId = 1;

export function onToast(fn: (toast: Toast) => void) {
  listener = fn;
}

export function toast(message: string, kind: Toast["kind"] = "ok") {
  listener({ id: nextId++, kind, message });
}

/** Pide confirmación, ejecuta la acción y avisa del resultado o del error del servidor. */
export async function confirmAndRun(question: string, action: () => Promise<unknown>, done: string) {
  if (!window.confirm(question)) return false;
  try {
    await action();
    toast(done);
    return true;
  } catch (e) {
    toast((e as Error).message, "error");
    return false;
  }
}
