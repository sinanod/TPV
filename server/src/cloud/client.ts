export class CloudError extends Error {
  /** status 0 = no hay conexión con la nube */
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function cloudRequest<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CloudError(0, "No se pudo conectar con la nube");
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new CloudError(res.status, data.error || `La nube respondió ${res.status}`);
  return data as T;
}

export function normalizeCloudUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new CloudError(400, "La dirección del portal no es válida");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CloudError(400, "La dirección del portal debe empezar por https://");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
