import { useEffect, useState } from "react";
import { dismissNotice, Notice, subscribeNotices } from "../lib/notify";

export function Notices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => subscribeNotices(setNotices), []);

  return (
    <div className="notices" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`notice notice-${n.kind}`}>
          <span>{n.text}</span>
          {n.action && (
            <button
              className="link"
              onClick={() => {
                n.action!.run();
                dismissNotice(n.id);
              }}
            >
              {n.action.label}
            </button>
          )}
          <button className="link" aria-label="Cerrar aviso" onClick={() => dismissNotice(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
