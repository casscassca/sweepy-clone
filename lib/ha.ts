function envValue(name: string) {
  return (process.env[name] ?? "").trim().replace(/^['"]+|['"]+$/g, "");
}

/** Sweepy → Home Assistant. One house token, from env — not the DB. */
export function haConfig(): { url: string; token: string } | null {
  const url = envValue("HA_URL").replace(/\/$/, "");
  const token = envValue("HA_TOKEN");
  if (!url || !token) return null;
  return { url, token };
}

export type HaConn = { url: string; token: string };

export type NotifyCatalog = {
  reachable: boolean;
  error?: string;
  /** Service names under the notify domain, e.g. mobile_app_pixel */
  services: string[];
  /** Entity ids, e.g. notify.pixel */
  entities: string[];
};

const SKIP_SERVICES = new Set(["send_message", "persistent_notification", "notify"]);

export async function listHaNotifyCatalog(ha: HaConn): Promise<NotifyCatalog> {
  const headers = { Authorization: `Bearer ${ha.token}` };
  let svcRes: Response;
  let stRes: Response;
  try {
    [svcRes, stRes] = await Promise.all([
      fetch(`${ha.url}/api/services`, { headers }),
      fetch(`${ha.url}/api/states`, { headers }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { reachable: false, error: msg, services: [], entities: [] };
  }

  if (!svcRes.ok) {
    const body = await svcRes.text();
    return { reachable: false, error: `HA ${svcRes.status} ${body.slice(0, 200)}`, services: [], entities: [] };
  }

  const servicesJson = await svcRes.json();
  const notify = Array.isArray(servicesJson)
    ? servicesJson.find((d: { domain?: string }) => d.domain === "notify")
    : null;
  const services = Object.keys(notify?.services ?? {}).filter((k) => !SKIP_SERVICES.has(k)).sort();

  const entities: string[] = [];
  if (stRes.ok) {
    const states = await stRes.json();
    if (Array.isArray(states)) {
      for (const s of states) {
        const id = String(s?.entity_id ?? "");
        if (id.startsWith("notify.") && id !== "notify.persistent_notification") entities.push(id);
      }
    }
  }
  entities.sort();

  return { reachable: true, services, entities };
}

export function resolveNotifyTarget(
  rawTarget: string,
  catalog: NotifyCatalog,
): { service: string; ok: boolean; hint?: string } {
  const stored = rawTarget.trim();
  const raw = stored.replace(/^notify\./, "");
  const serviceMap = new Map(catalog.services.map((s) => [s.toLowerCase(), s]));

  if (serviceMap.has(raw.toLowerCase())) {
    return { service: serviceMap.get(raw.toLowerCase())!, ok: true };
  }

  const prefixed = `mobile_app_${raw}`.toLowerCase();
  if (serviceMap.has(prefixed)) {
    const service = serviceMap.get(prefixed)!;
    return { service, ok: true, hint: `${stored} → notify.${service}` };
  }

  return {
    service: raw,
    ok: catalog.services.length === 0,
    hint:
      catalog.services.length > 0
        ? `No notify service for ${stored}. Services: ${catalog.services.map((s) => `notify.${s}`).join(", ")}`
        : undefined,
  };
}

export async function postHaService(
  ha: HaConn,
  domain: string,
  service: string,
  payload: object,
) {
  const url = `${ha.url}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ha.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: await res.text(), url };
}

export async function postNotify(ha: HaConn, service: string, payload: object) {
  return postHaService(ha, "notify", service, payload);
}
