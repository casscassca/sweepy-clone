"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Moon, ScrollText, Sun } from "lucide-react";
import { format } from "date-fns";
import { backupIsStale } from "@/lib/backup";
import { loadJson } from "@/lib/api-cache";

type LoadWeek = { needPts: number; capPts: number; needTasks: number; capTasks: number; typicalPts?: number };
type LoadStatus = {
  taskCount: number;
  week: LoadWeek;
  catchUp?: { pts: number; tasks: number; days?: number | null };
};

type HaPerson = { name: string; target: string; resolved: string | null; ok: boolean; hint: string | null };
type HaLog = { id: string; createdAt: string; kind: string; ok: boolean; userName: string; summary: string; detail: string };
type HaMqttStatus = {
  configured: boolean;
  connected: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
  url: string | null;
};
type HaStatus = {
  configured: boolean;
  url: string | null;
  reachable: boolean;
  listening?: boolean;
  lastEventAt?: string | null;
  listenError?: string | null;
  error: string | null;
  services: string[];
  entities: string[];
  people: HaPerson[];
  log: HaLog[];
  mqtt?: HaMqttStatus;
};

export default function SettingsPage() {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [ha, setHa] = useState<HaStatus | null>(null);
  const [openLogId, setOpenLogId] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showHaDetails, setShowHaDetails] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [load, setLoad] = useState<LoadStatus | null>(null);
  const [backupAt, setBackupAt] = useState<string | null>(null);
  const [backupLoaded, setBackupLoaded] = useState(false);

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/ha-webhook`);
    setDarkMode(document.documentElement.getAttribute("data-theme") === "dark");
    fetch("/api/ha-status")
      .then((res) => res.ok ? res.json() : null)
      .then(setHa)
      .catch(() => setHa(null));
    void loadJson<LoadStatus | null>("/api/load", null, (data) => setLoad(data?.week ? data : null));
    void loadJson<{ backupAt?: string | null }>("/api/settings", {}, (s) => {
      setBackupAt(s.backupAt ?? null);
      setBackupLoaded(true);
    });
  }, []);

  function toggleDark() {
    const next = !darkMode;
    setDarkMode(next);
    if (next) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    }
  }

  return (
    <div className="max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text2)" }}>Appearance and Home Assistant</p>
      </div>

      <div className="p-5 rounded-2xl mb-4" style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
        <h2 className="font-medium mb-4">Appearance</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Dark mode</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>Saved in your browser</p>
          </div>
          <button
            onClick={toggleDark}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all"
            style={{
              background: darkMode ? "var(--accent-dim)" : "var(--surface2)",
              color: darkMode ? "var(--accent)" : "var(--text2)",
              border: "1px solid var(--border)",
            }}
          >
            {darkMode ? <Moon size={14} /> : <Sun size={14} />}
            {darkMode ? "Dark" : "Light"}
          </button>
        </div>
        {load && <WorkloadCard load={load} />}
      </div>

      <div className="p-5 rounded-2xl mb-4" style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
        <h2 className="font-medium mb-2">Backup</h2>
        <p className="text-sm" style={{ color: backupLoaded && backupIsStale(backupAt) ? "var(--red)" : "var(--text2)" }}>
          {!backupLoaded
            ? "Checking…"
            : backupAt
              ? `Last backup ${format(new Date(backupAt), "EEEE, MMM d 'at' h:mm a")}`
              : "No backup yet"}
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--text3)" }}>
          Daily copy to Google Drive, in backups/sweepy. The last 30 days are kept.
        </p>
      </div>

      <div className="p-5 rounded-2xl space-y-3 mb-4" style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
        <h2 className="font-medium">Home Assistant</h2>
        {ha ? (
          <div className="space-y-1">
            <p className="text-sm" style={{ color: ha.reachable ? "var(--green)" : "var(--red)" }}>
              {ha.reachable ? `Connected to ${ha.url}` : ha.error ?? "Not connected"}
            </p>
            <p className="text-sm" style={{ color: ha.listening ? "var(--green)" : "var(--text3)" }}>
              {ha.listening
                ? "Listening for Done / Tomorrow / Yesterday taps"
                : ha.listenError ?? "Not listening for button taps yet"}
            </p>
            <p className="text-sm" style={{ color: ha.mqtt?.connected ? "var(--green)" : "var(--text3)" }}>
              {ha.mqtt?.connected
                ? `Publishing rooms and chores to ${ha.mqtt.url}`
                : ha.mqtt?.lastError ?? "MQTT not connected"}
            </p>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--text3)" }}>Checking connection…</p>
        )}

        {ha && ha.people.length > 0 && (
          <ul className="space-y-1.5 pt-1">
            {ha.people.map((p) => (
              <li key={p.name} className="text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs font-mono ml-2" style={{ color: p.ok ? "var(--text2)" : "var(--red)" }}>
                  {p.target || "—"}
                  {p.resolved && p.resolved !== p.target ? ` → ${p.resolved}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium pt-1"
          style={{ color: "var(--text2)" }}
        >
          {showLog ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          HA log
          {ha && ha.log.length > 0 && (
            <span className="text-xs font-normal" style={{ color: "var(--text3)" }}>{ha.log.length}</span>
          )}
        </button>
        {showLog && (
          !ha || ha.log.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text3)" }}>Nothing yet. Bell on People and Done / Tomorrow / Yesterday taps show up here.</p>
          ) : (
            <ul className="space-y-2">
              {ha.log.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setOpenLogId(openLogId === row.id ? null : row.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-mono shrink-0 mt-0.5" style={{ color: "var(--text3)" }}>
                        {format(new Date(row.createdAt), "HH:mm")}
                      </span>
                      <span className="text-sm min-w-0" style={{ color: row.ok ? "var(--text)" : "var(--red)" }}>
                        {row.summary}
                      </span>
                    </div>
                  </button>
                  {openLogId === row.id && row.detail && (
                    <pre className="mt-1.5 ml-10 text-xs font-mono whitespace-pre-wrap break-all px-3 py-2 rounded-xl" style={{ background: "var(--surface2)", color: "var(--text2)" }}>
                      {row.detail}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )
        )}

        <button
          type="button"
          onClick={() => setShowHaDetails((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium"
          style={{ color: "var(--text2)" }}
        >
          {showHaDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Connection details
        </button>
        {showHaDetails && (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: "var(--text2)" }}>
              The house connection is <code className="text-xs">HA_URL</code> and <code className="text-xs">HA_TOKEN</code> in the Pi <code className="text-xs">.env</code>, one token for everyone.
              Sweepy listens for the notification buttons on that connection, so you do not need a Home Assistant automation for Done / Tomorrow / Yesterday.
            </p>
            <p className="text-sm" style={{ color: "var(--text2)" }}>
              Chore sensors use the same Mosquitto broker as Zigbee, no login. Set <code className="text-xs">MQTT_URL</code> in that same <code className="text-xs">.env</code>. Rooms show up as Home Assistant devices with a cleanliness % and each catalog chore as a dirt sensor.
            </p>
            {ha && ha.services.length > 0 && (
              <div>
                <p className="text-xs mb-1.5" style={{ color: "var(--text3)" }}>Notify services HA will accept</p>
                <ul className="space-y-1">
                  {ha.services.map((s) => (
                    <li key={s} className="text-xs font-mono" style={{ color: "var(--text2)" }}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs" style={{ color: "var(--text3)" }}>
              Optional backup webhook if the live listener is down: <span className="font-mono">{webhookUrl || "/api/ha-webhook"}</span>
            </p>
          </div>
        )}
      </div>

      <Link
        href="/history"
        className="flex items-center gap-3 p-5 rounded-2xl mb-4"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}
      >
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
        >
          <ScrollText size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium">Completion history</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>A timeline of everything that’s been checked off</p>
        </div>
      </Link>

      <div className="p-5 rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
        <button
          type="button"
          onClick={() => setShowHow((v) => !v)}
          className="flex items-center gap-1.5 font-medium w-full text-left"
        >
          {showHow ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          How it works
        </button>
        {showHow && (
          <ul className="space-y-2 mt-3">
            {[
              "At midnight, auto-picks are refreshed for the next few weeks so dirtier and important chores float up. Pins, things you moved by hand, and one-offs stay put",
              "At each person's notify time, one push notification fires per task with Done, Tomorrow, and Yesterday. The bell on People clears their phone first, then resends from today's list",
              "If they set a resend time, leftover banners are wiped at that time and any still-open chores go out again",
              "Done checks it off today. Tomorrow moves it to the next day. Yesterday moves it to yesterday and checks it off, and pulls in one more chore only if there is still room under today's cap",
              "Tasks can be checked off or deferred in the Today and Upcoming views too",
              "Pins, one-offs, and anything you add or move by hand stay on that day even if it goes over someone's cap. Extra auto-picks still slide forward",
            ].map((line) => (
              <li key={line} className="flex gap-2.5 text-sm" style={{ color: "var(--text2)" }}>
                <span style={{ color: "var(--accent-light)", marginTop: "2px" }}>·</span>
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function fmt(n: number) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function WorkloadCard({ load }: { load: LoadStatus }) {
  const typicalPts = load.week.typicalPts ?? load.week.capPts;
  const gap = load.week.needPts - typicalPts;
  const behind = gap > 0.05;
  const catchUpPts = load.catchUp?.pts ?? 0;
  const catchUpTasks = load.catchUp?.tasks ?? 0;
  const dirty = catchUpPts > 0.05;
  const scale = Math.max(load.week.needPts, load.week.capPts, 1);
  const slack = typicalPts - load.week.needPts;
  const headline = behind
    ? `Typical mix is ${fmt(gap)} pts short each week`
    : slack > 0.05
      ? `${fmt(slack)} pts of slack each week at a typical mix`
      : "Typical mix covers the catalog";
  const pace = !dirty
    ? null
    : load.catchUp?.days != null
      ? `About ${fmt(load.catchUp.days)} days at a typical mix`
      : "Typical days are used staying current, so overdue work sits";

  return (
    <div className="mt-5 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-medium">Workload</h3>
        <Link href="/users" className="text-xs shrink-0" style={{ color: "var(--accent)" }}>
          Edit caps
        </Link>
      </div>
      <p className="text-sm font-medium mb-4" style={{ color: behind ? "var(--red)" : "var(--green)" }}>
        {headline}
      </p>

      <div className="relative h-2 rounded-full mb-3" style={{ background: "var(--surface2)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, (load.week.needPts / scale) * 100)}%`,
            background: behind ? "var(--red)" : "var(--green)",
          }}
        />
        <div
          className="absolute top-0 bottom-0 w-0.5 rounded-full"
          title="Combined weekly cap"
          style={{
            left: `${Math.min(100, (load.week.capPts / scale) * 100)}%`,
            background: "var(--text)",
            transform: "translateX(-50%)",
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs" style={{ color: "var(--text3)" }}>To stay where we are</p>
          <p className="text-lg font-semibold tracking-tight">{fmt(load.week.needPts)} <span className="text-xs font-medium" style={{ color: "var(--text3)" }}>pts/week</span></p>
          <p className="text-xs" style={{ color: "var(--text3)" }}>{fmt(load.week.needPts / 7)} / day</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "var(--text3)" }}>Combined cap</p>
          <p className="text-lg font-semibold tracking-tight">{fmt(load.week.capPts)} <span className="text-xs font-medium" style={{ color: "var(--text3)" }}>pts/week max</span></p>
          <p className="text-xs" style={{ color: "var(--text3)" }}>{fmt(typicalPts)} typical · {fmt(typicalPts / 7)} / day</p>
        </div>
      </div>

      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <p className="text-xs" style={{ color: "var(--text3)" }}>To catch up</p>
        {dirty ? (
          <>
            <p className="text-lg font-semibold tracking-tight">{fmt(catchUpPts)} <span className="text-xs font-medium" style={{ color: "var(--text3)" }}>pts overdue</span></p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>
              {catchUpTasks} of {load.taskCount} in the catalog past due{pace ? ` · ${pace}` : ""}
            </p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold tracking-tight" style={{ color: "var(--green)" }}>Nothing is overdue</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>Due today still counts as current</p>
          </>
        )}
      </div>

      <p className="text-xs mt-4" style={{ color: "var(--text3)" }}>
        {fmt(load.week.needTasks)} chores/week · {fmt(load.week.capTasks)} task seats/week
        {load.taskCount ? ` · ${load.taskCount} in the catalog` : ""}
      </p>
    </div>
  );
}
