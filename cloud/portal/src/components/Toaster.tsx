import { useEffect, useState } from "react";
import { onToast, Toast } from "../lib/notify";

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    onToast((t) => {
      setToasts((list) => [...list.slice(-2), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.kind === "error" ? 6000 : 3000);
    });
  }, []);

  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
