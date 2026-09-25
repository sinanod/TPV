const STORAGE_KEY = "tpv_server_url";

export function getServerUrl(): string {
  return localStorage.getItem(STORAGE_KEY) || `http://${location.hostname}:4000`;
}

export function setServerUrl(url: string) {
  localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ""));
}
