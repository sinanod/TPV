import { DependencyList, useCallback, useEffect, useRef, useState } from "react";
import { subscribe, RealtimeEvent } from "./socket";

export function useResource<T>(load: () => Promise<T>, events: RealtimeEvent[], deps: DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastRequest = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++lastRequest.current;
    try {
      const result = await loadRef.current();
      // Si el usuario cambia de filtro rápido, una respuesta antigua no debe pisar a la nueva.
      if (requestId !== lastRequest.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (requestId === lastRequest.current) setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload, ...deps]);

  const eventKey = events.join(",");
  useEffect(() => subscribe(eventKey.split(",") as RealtimeEvent[], reload), [eventKey, reload]);

  return { data, error, reload, setData };
}
