// Lightweight persistent host; renderer loads only while enabled and visible.
import { useEffect, useRef, useState } from "react";
import type { AgentStatus, AppSettings } from "../../src/shared/ui-contract";
import type { createKiwiCat } from "../kiwicat/cat";
import { api, has } from "../src/api";
import { CatActivity } from "./cat-state";
type Cat = Awaited<ReturnType<typeof createKiwiCat>>;
function CatMount({ busy, reduced }: { busy: boolean; reduced: boolean }) {
  const handle = useRef<Cat | undefined>(undefined);
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  useEffect(() => { handle.current?.update({ parado: reduced }); }, [reduced]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current!;
    let gone = false, loading = false, cat: Cat | undefined;
    const activity = new CatActivity(busy);
    const state = () => { if (cat) { cat.update({ estado: activity.state }); el.dataset.state = cat.visualState; } };
    async function create() {
      if (gone || cat || loading || document.hidden) return;
      loading = true;
      try {
        const { createKiwiCat } = await import("../kiwicat/cat");
        if (gone || document.hidden) return;
        const next = await createKiwiCat(el, { mode: "runtime", width: 96, height: 120, cutout: true, outline: true,
          inputs: { estado: activity.state, cor: "claude", voz: null, parado: reducedRef.current } });
        if (gone) { await next.dispose(); return; }
        cat = next; handle.current = cat; cat.update({ parado: reducedRef.current }); cat.visibility(document.hidden); state(); el.dataset.ready = "true";
      } catch { el.replaceChildren(); }
      finally { loading = false; }
    }
    const off = api.agent.onTurn(e => { const previous = activity.state; activity.event(e); if (activity.state !== previous) state(); });
    const visibility = () => {
      if (cat) {
        cat.visibility(document.hidden);
        if (!document.hidden && activity.state === "repouso") state();
      } else void create();
    };
    document.addEventListener("visibilitychange", visibility);
    void create();
    return () => {
      gone = true; off(); document.removeEventListener("visibilitychange", visibility);
      handle.current = undefined;
      if (cat) void cat.dispose();
    };
  }, []);
  return <div className="kn-kiwicat" aria-hidden="true" ref={root} />;
}
export function KiwiCat() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    if (!has("agent.status") || !has("settings.get")) return;
    let alive = true, statusEvents = 0, settingsEvents = 0;
    const offStatus = api.agent.onStatus(s => { statusEvents++; if (alive) setStatus(s); });
    const offSettings = api.settings.onChanged(s => { settingsEvents++; if (alive) setSettings(s); });
    const st = statusEvents, se = settingsEvents;
    void api.agent.status().then(s => { if (alive && statusEvents === st) setStatus(s); }, () => {});
    void api.settings.get().then(s => { if (alive && settingsEvents === se) setSettings(s); }, () => {});
    return () => { alive = false; offStatus(); offSettings(); };
  }, []);
  return status?.enabled && settings?.kiwicat?.show === true ? <CatMount busy={status.busy} reduced={settings.appearance.motion === "reduced"} /> : null;
}
