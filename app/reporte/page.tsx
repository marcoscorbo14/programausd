"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AppPageHeader } from "@/app/components/app-page-header";
import { canViewReports, getProfileWithRole, type AppRole } from "@/lib/security";

type DailyClosingRow = {
  id: string;
  business_date: string;
  pnl_total_ars: number | null;
  pnl_operativo_ars: number | null;
  pnl_valuacion_ars: number | null;
  ars_open: number | null;
  ars_close: number | null;
  usd_open: number | null;
  usd_close: number | null;
  created_at: string | null;
};

type PresetKey = "yesterday" | "7" | "15" | "30" | "365" | "custom";

function todayLocalYYYYMMDD() {
  return new Date().toLocaleDateString("en-CA");
}
function yyyyMmDdMinusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString("en-CA");
}

const nf0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtARS(n: number, decimals: 0 | 2 = 2) {
  const x = Number(n ?? 0);
  const body = decimals === 2 ? nf2.format(x) : nf0.format(x);
  return `$ ${body}`;
}
function fmtUSD(n: number, decimals: 0 | 2 = 2) {
  const x = Number(n ?? 0);
  const body = decimals === 2 ? nf2.format(x) : nf0.format(x);
  return `U$D ${body}`;
}
function fmtDateAR(yyyyMmDd: string) {
  return new Date(`${yyyyMmDd}T00:00:00`).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Cordoba",
  });
}
function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function getGainARS(c: DailyClosingRow) {
  if (isFiniteNumber(c.ars_open) && isFiniteNumber(c.ars_close)) return c.ars_close - c.ars_open;
  return null;
}
function getGainUSD(c: DailyClosingRow) {
  if (isFiniteNumber(c.usd_open) && isFiniteNumber(c.usd_close)) return c.usd_close - c.usd_open;
  return null;
}

export default function ReportePage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<AppRole>("operator");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [preset, setPreset] = useState<PresetKey>("30");
  const [rangeFrom, setRangeFrom] = useState<string>(yyyyMmDdMinusDays(30));
  const [rangeTo, setRangeTo] = useState<string>(todayLocalYYYYMMDD());

  const [closings, setClosings] = useState<DailyClosingRow[]>([]);

  const totals = useMemo(() => {
    let ars = 0;
    let usd = 0;
    let arsComplete = true;
    let usdComplete = true;
    let operativo = 0;
    let valuacion = 0;
    for (const c of closings) {
      const gainArs = getGainARS(c);
      const gainUsd = getGainUSD(c);
      if (isFiniteNumber(gainArs)) ars += gainArs;
      else arsComplete = false;
      if (isFiniteNumber(gainUsd)) usd += gainUsd;
      else usdComplete = false;
      operativo += Number(c.pnl_operativo_ars ?? 0);
      valuacion += Number(c.pnl_valuacion_ars ?? 0);
    }
    return { ars, usd, arsComplete, usdComplete, operativo, valuacion };
  }, [closings]);

  const chartSeries = useMemo(() => {
    const asc = [...closings].sort((a, b) => String(a.business_date).localeCompare(String(b.business_date)));
    return asc.map((c) => ({
      date: c.business_date,
      ars: getGainARS(c) ?? 0,
    }));
  }, [closings]);

  const chartPath = useMemo(() => {
    if (chartSeries.length < 2) return "";
    const w = 620;
    const h = 180;
    const pad = 14;
    const values = chartSeries.map((p) => p.ars);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const span = max - min || 1;

    const points = chartSeries.map((p, i) => {
      const x = pad + (i * (w - pad * 2)) / (chartSeries.length - 1);
      const y = h - pad - ((p.ars - min) * (h - pad * 2)) / span;
      return `${x},${y}`;
    });
    return points.join(" ");
  }, [chartSeries]);

  const zeroLineY = useMemo(() => {
    const h = 180;
    const pad = 14;
    if (chartSeries.length === 0) return h - pad;
    const values = chartSeries.map((p) => p.ars);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const span = max - min || 1;
    return h - pad - ((0 - min) * (h - pad * 2)) / span;
  }, [chartSeries]);

  const applyPreset = (value: PresetKey) => {
    const today = todayLocalYYYYMMDD();
    if (value === "custom") return;
    if (value === "yesterday") {
      const y = yyyyMmDdMinusDays(1);
      setRangeFrom(y);
      setRangeTo(y);
      return;
    }
    const days = Number(value);
    setRangeFrom(yyyyMmDdMinusDays(days));
    setRangeTo(today);
  };

  const loadBase = async () => {
    setLoading(true);
    setErrMsg(null);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;

    if (!user) {
      setEmail(null);
      setClosings([]);
      setLoading(false);
      return;
    }

    setEmail(user.email ?? null);

    const profile = await getProfileWithRole(user.id);
    setRole(profile.role);
    if (profile.error || !profile.tenant_id) {
      setErrMsg("No pude leer tu perfil (profiles).");
      setLoading(false);
      return;
    }
    if (!canViewReports(profile.role)) {
      setErrMsg("No tenés permisos para ver reportes.");
      setClosings([]);
      setLoading(false);
      return;
    }

    const { data: branches, error: brErr } = await supabase
      .from("branches")
      .select("id,name")
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: true })
      .limit(1);

    if (brErr) {
      console.error(brErr);
      setErrMsg("No pude leer sucursales (branches).");
      setLoading(false);
      return;
    }

    const b = branches?.[0] ?? null;

    if (!b) {
      setErrMsg("No tenés sucursales creadas.");
      setLoading(false);
      return;
    }

    const { data: hist, error: histErr } = await supabase
      .from("daily_closings")
      .select(
        "id,business_date,pnl_total_ars,pnl_operativo_ars,pnl_valuacion_ars,ars_open,ars_close,usd_open,usd_close,created_at"
      )
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .gte("business_date", rangeFrom)
      .lte("business_date", rangeTo)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(365);

    if (histErr) {
      console.error(histErr);
      setErrMsg("No pude leer cierres (daily_closings).");
      setClosings([]);
      setLoading(false);
      return;
    }

    const rows = (hist ?? []) as DailyClosingRow[];
    const byDay = new Map<string, DailyClosingRow>();
    for (const r of rows) {
      const prev = byDay.get(r.business_date);
      if (!prev) {
        byDay.set(r.business_date, r);
        continue;
      }
      const prevTs = prev.created_at ? new Date(prev.created_at).getTime() : 0;
      const curTs = r.created_at ? new Date(r.created_at).getTime() : 0;
      if (curTs >= prevTs) byDay.set(r.business_date, r);
    }

    const unique = Array.from(byDay.values()).sort((a, b2) =>
      String(b2.business_date).localeCompare(String(a.business_date))
    );
    setClosings(unique);
    setLoading(false);
  };

  useEffect(() => {
    void loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeFrom, rangeTo]);

  const signIn = async () => {
    const redirectTo = `${window.location.origin}/reporte`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setEmail(null);
    setClosings([]);
  };

  return (
    <main className="cc-app min-h-screen flex items-start justify-center px-3 py-4 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-5 md:max-w-2xl lg:max-w-3xl">
        <AppPageHeader title="Reporte" activeTab="reporte" role={role} />

        <div className="mt-3 text-xs opacity-70">Filtro preestablecido</div>
        <select
          value={preset}
          onChange={(e) => {
            const p = e.target.value as PresetKey;
            setPreset(p);
            applyPreset(p);
          }}
          className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 text-sm outline-none"
        >
          <option value="yesterday">Ayer</option>
          <option value="7">Últimos 7 días</option>
          <option value="15">Últimos 15 días</option>
          <option value="30">Últimos 30 días</option>
          <option value="365">Últimos 365 días</option>
          <option value="custom">Personalizable</option>
        </select>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs opacity-70">Desde</label>
            <input
              type="date"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              disabled={preset !== "custom"}
              className="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 outline-none disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs opacity-70">Hasta</label>
            <input
              type="date"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              disabled={preset !== "custom"}
              className="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 outline-none disabled:opacity-50"
            />
          </div>
        </div>

        <div className="mt-2 text-xs opacity-70">
          Rango actual: <b>{rangeFrom}</b> → <b>{rangeTo}</b>
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="text-sm opacity-70">Cargando...</div>
          ) : !email ? (
            <button
              onClick={signIn}
              className="w-full rounded-xl border border-white/15 px-4 py-2 hover:bg-white/10"
            >
              Entrar con Google
            </button>
          ) : (
            <>
              {errMsg ? (
                <div role="alert" aria-live="assertive" className="mt-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm">{errMsg}</div>
              ) : null}

              <div className="mt-4 rounded-xl border border-white/10 p-4">
                <div className="text-xs uppercase tracking-widest opacity-70">Resumen ({closings.length} cierres)</div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/10 p-3">
                    <div className="text-xs opacity-70">Ganancia/pérdida ARS</div>
                    <div className="mt-1 text-lg font-semibold">{totals.arsComplete ? fmtARS(totals.ars) : "N/D"}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 p-3">
                    <div className="text-xs opacity-70">Ganancia/pérdida USD</div>
                    <div className="mt-1 text-lg font-semibold">{totals.usdComplete ? fmtUSD(totals.usd) : "N/D"}</div>
                  </div>
                </div>
                <div className="mt-2 text-xs opacity-70">
                  Operativo: <b>{fmtARS(totals.operativo)}</b> • Valuación: <b>{fmtARS(totals.valuacion)}</b>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 p-4">
                <div className="text-xs uppercase tracking-widest opacity-70">Ganancias por día</div>
                {chartSeries.length === 0 ? (
                  <div className="mt-2 text-sm opacity-70">Sin datos para graficar.</div>
                ) : chartSeries.length === 1 ? (
                  <div className="mt-2 text-sm opacity-70">
                    {fmtDateAR(chartSeries[0].date)}: <b>{fmtARS(chartSeries[0].ars)}</b>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-white/10 p-2">
                    <svg
                      viewBox="0 0 620 180"
                      className="h-40 w-full"
                      role="img"
                      aria-labelledby="chart-title chart-desc"
                    >
                      <title id="chart-title">Ganancias diarias en ARS</title>
                      <desc id="chart-desc">
                        Evolución de ganancias por día en pesos para el rango seleccionado.
                      </desc>
                      <line x1="14" y1={zeroLineY} x2="606" y2={zeroLineY} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                      <polyline fill="none" stroke="rgb(16 185 129)" strokeWidth="2.5" points={chartPath} />
                    </svg>
                    <div className="mt-1 flex items-center justify-between text-[11px] opacity-70">
                      <span>{fmtDateAR(chartSeries[0].date)}</span>
                      <span>{fmtDateAR(chartSeries[chartSeries.length - 1].date)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-white/10 p-4">
                <div className="text-xs uppercase tracking-widest opacity-70">Cierres del período</div>
                {closings.length === 0 ? (
                  <div className="mt-3 text-sm opacity-70">No hay cierres guardados para este rango.</div>
                ) : (
                  <div className="mt-3 divide-y divide-white/10 rounded-xl border border-white/10">
                    {closings.map((c) => {
                      const gainArs = getGainARS(c);
                      const gainUsd = getGainUSD(c);
                      return (
                        <div key={c.id} className="p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium">{fmtDateAR(c.business_date)}</div>
                            <div className="text-sm font-semibold">{isFiniteNumber(gainArs) ? fmtARS(gainArs) : "N/D"}</div>
                          </div>
                          <div className="mt-1 text-xs opacity-70">
                            USD: <b>{isFiniteNumber(gainUsd) ? fmtUSD(gainUsd) : "N/D"}</b> • Operativo: <b>{fmtARS(Number(c.pnl_operativo_ars ?? 0))}</b> • Valuación:{" "}
                            <b>{fmtARS(Number(c.pnl_valuacion_ars ?? 0))}</b>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                onClick={signOut}
                className="mt-6 w-full rounded-xl border border-white/10 px-4 py-2 text-sm opacity-80 hover:bg-white/5"
              >
                Cerrar sesión
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
