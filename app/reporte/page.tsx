"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type ProfileRow = { id: string; email: string | null; tenant_id: string | null };
type BranchRow = { id: string; name: string };

type DailyOpeningRow = {
  id: string;
  business_date: string;
  ars_open: number;
  usd_open: number;
  branch_id: string | null;
};

type OperationRow = {
  id: string;
  op_time: string;
  op_type: "BUY_USD" | "SELL_USD";
  usd_amount: number;
  price_ars_per_usd: number;
  ars_amount: number;
  fee_ars: number;
  client_name_snapshot: string | null;
};

type DailyClosingRow = {
  id: string;
  business_date: string;
  pnl_total_ars: number;
  pnl_operativo_ars: number;
  pnl_valuacion_ars: number;
  created_at: string;
};

function todayLocalYYYYMMDD() {
  return new Date().toLocaleDateString("en-CA");
}
function yyyyMmDdMinusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString("en-CA");
}

// --- FORMATO es-AR ---
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

export default function ReportePage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [branch, setBranch] = useState<BranchRow | null>(null);

  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Ventana 30 días (resumen)
  const [windowDays, setWindowDays] = useState(30);
const [customDays, setCustomDays] = useState(30);
const fromDate = useMemo(() => yyyyMmDdMinusDays(windowDays), [windowDays]);
const today = useMemo(() => todayLocalYYYYMMDD(), []);

const [rangeFrom, setRangeFrom] = useState<string>(fromDate);
const [rangeTo, setRangeTo] = useState<string>(today);

  const [closings, setClosings] = useState<DailyClosingRow[]>([]);

  // Detalle por día
  const [day, setDay] = useState<string>(todayLocalYYYYMMDD());
  const [openingDay, setOpeningDay] = useState<DailyOpeningRow | null>(null);
  const [opsDay, setOpsDay] = useState<OperationRow[]>([]);
  const [closingDay, setClosingDay] = useState<DailyClosingRow | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);

  const totals30 = useMemo(() => {
    let total = 0, op = 0, val = 0;
    for (const c of closings) {
      total += c.pnl_total_ars ?? 0;
      op += c.pnl_operativo_ars ?? 0;
      val += c.pnl_valuacion_ars ?? 0;
    }
    return { total, op, val };
  }, [closings]);

  const cashDay = useMemo(() => {
    if (!openingDay) return null;

    let ars = openingDay.ars_open;
    let usd = openingDay.usd_open;
    let fees = 0;

    let usdBought = 0;
    let usdSold = 0;

    for (const o of opsDay) {
      const feeMov = o.fee_ars ?? 0;
      fees += feeMov;

      if (o.op_type === "SELL_USD") {
        ars += o.ars_amount;
        usd -= o.usd_amount;
        usdSold += o.usd_amount;
      } else {
        ars -= o.ars_amount;
        usd += o.usd_amount;
        usdBought += o.usd_amount;
      }
      ars -= feeMov;
    }

    return { ars, usd, fees, usdBought, usdSold };
  }, [openingDay, opsDay]);

  const loadBase = async () => {
    setLoading(true);
    setErrMsg(null);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;

    if (!user) {
      setEmail(null);
      setTenantId(null);
      setBranch(null);
      setClosings([]);
      setLoading(false);
      return;
    }

    setEmail(user.email ?? null);

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id,email,tenant_id")
      .eq("id", user.id)
      .single<ProfileRow>();

    if (profileErr || !profile?.tenant_id) {
      console.error(profileErr);
      setErrMsg("No pude leer tu perfil (profiles).");
      setLoading(false);
      return;
    }

    setTenantId(profile.tenant_id);

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
    setBranch(b);

    if (!b) {
      setErrMsg("No tenés sucursales creadas.");
      setLoading(false);
      return;
    }

    const { data: hist, error: histErr } = await supabase
      .from("daily_closings")
      .select("id,business_date,pnl_total_ars,pnl_operativo_ars,pnl_valuacion_ars,created_at")
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

// Por seguridad: si existieran varios cierres del mismo business_date,
// nos quedamos con el más nuevo (mayor created_at).
const byDay = new Map<string, DailyClosingRow>();
for (const r of rows) {
  const key = r.business_date;
  const prev = byDay.get(key);
  if (!prev) {
    byDay.set(key, r);
    continue;
  }
  const prevTs = prev.created_at ? new Date(prev.created_at).getTime() : 0;
  const curTs = r.created_at ? new Date(r.created_at).getTime() : 0;
  if (curTs >= prevTs) byDay.set(key, r);
}

// Queda una lista sin duplicados por día, ordenada por fecha desc
const unique = Array.from(byDay.values()).sort((a, b) =>
  String(b.business_date).localeCompare(String(a.business_date))
);

setClosings(unique);
    setLoading(false);
  };

  const loadDayDetail = async () => {
    if (!tenantId || !branch?.id) return;
    setLoadingDay(true);

    // arranque
    const { data: openRow } = await supabase
      .from("daily_openings")
      .select("id,business_date,ars_open,usd_open,branch_id")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branch.id)
      .eq("business_date", day)
      .maybeSingle<DailyOpeningRow>();

    setOpeningDay(openRow ?? null);

    // operaciones
    const start = `${day}T00:00:00`;
    const end = `${day}T23:59:59`;

    const { data: opRows } = await supabase
      .from("operations")
      .select("id,op_time,op_type,usd_amount,price_ars_per_usd,ars_amount,fee_ars,client_name_snapshot")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branch.id)
      .eq("is_void", false)
      .gte("op_time", start)
      .lte("op_time", end)
      .order("op_time", { ascending: false })
      .limit(200);

    setOpsDay((opRows ?? []) as OperationRow[]);

    // cierre guardado
    const { data: closRows } = await supabase
      .from("daily_closings")
      .select("id,business_date,pnl_total_ars,pnl_operativo_ars,pnl_valuacion_ars,created_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branch.id)
      .eq("business_date", day)
      .limit(1);

    setClosingDay((closRows?.[0] ?? null) as DailyClosingRow | null);

    setLoadingDay(false);
  };

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tenantId && branch?.id) loadDayDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, branch?.id, day]);

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
    setTenantId(null);
    setBranch(null);
    setClosings([]);
    setOpeningDay(null);
    setOpsDay([]);
    setClosingDay(null);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
        <div className="text-xs uppercase tracking-widest opacity-70">Control Cambio</div>
        <h1 className="mt-2 text-2xl font-semibold">Reporte</h1>

        <div className="mt-2 text-sm opacity-70">Ventana</div>

<div className="mt-2 flex flex-wrap gap-2">
  <button
    type="button"
    onClick={() => {
      const d = 7;
      setWindowDays(d);
      setCustomDays(d);
      setRangeFrom(yyyyMmDdMinusDays(d));
      setRangeTo(todayLocalYYYYMMDD());
    }}
    className={`rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10 ${
      windowDays === 7 ? "bg-white/10" : ""
    }`}
  >
    Últimos 7
  </button>

  <button
    type="button"
    onClick={() => {
      const d = 15;
      setWindowDays(d);
      setCustomDays(d);
      setRangeFrom(yyyyMmDdMinusDays(d));
      setRangeTo(todayLocalYYYYMMDD());
    }}
    className={`rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10 ${
      windowDays === 15 ? "bg-white/10" : ""
    }`}
  >
    Últimos 15
  </button>

  <button
    type="button"
    onClick={() => {
      const d = 30;
      setWindowDays(d);
      setCustomDays(d);
      setRangeFrom(yyyyMmDdMinusDays(d));
      setRangeTo(todayLocalYYYYMMDD());
    }}
    className={`rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10 ${
      windowDays === 30 ? "bg-white/10" : ""
    }`}
  >
    Últimos 30
  </button>

  <button
    type="button"
    onClick={() => {
      const d = 365;
      setWindowDays(d);
      setCustomDays(d);
      setRangeFrom(yyyyMmDdMinusDays(d));
      setRangeTo(todayLocalYYYYMMDD());
    }}
    className={`rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10 ${
      windowDays === 365 ? "bg-white/10" : ""
    }`}
  >
    Últimos 365
  </button>
</div>

<div className="mt-3 flex flex-wrap items-end gap-3">
  <div>
    <label className="block text-xs opacity-70">Desde</label>
    <input
      type="date"
      value={rangeFrom}
      onChange={(e) => setRangeFrom(e.target.value)}
      className="mt-1 rounded-lg border border-white/15 bg-transparent px-3 py-2 outline-none"
    />
  </div>

  <div>
    <label className="block text-xs opacity-70">Hasta</label>
    <input
      type="date"
      value={rangeTo}
      onChange={(e) => setRangeTo(e.target.value)}
      className="mt-1 rounded-lg border border-white/15 bg-transparent px-3 py-2 outline-none"
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
              <div className="text-sm opacity-70">Conectado como</div>
              <div className="mt-1 font-medium">{email}</div>

              <div className="mt-4 text-sm opacity-70">Sucursal</div>
              <div className="mt-1 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                {branch?.name ?? "(sin sucursal)"}
              </div>

              {errMsg ? (
                <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm">
                  {errMsg}
                </div>
              ) : null}

              {/* RESUMEN 30 DIAS */}
              <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-4">
                <div className="text-xs uppercase tracking-widest opacity-70">Resumen (30 días)</div>
                <div className="mt-2 text-lg font-semibold">{fmtARS(totals30.total)}</div>
                <div className="mt-1 text-xs opacity-70">
                  Operativo: <b>{fmtARS(totals30.op)}</b> • Valuación: <b>{fmtARS(totals30.val)}</b>
                </div>
              </div>

              {/* DETALLE DEL DIA */}
              <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-widest opacity-70">Detalle del día</div>
                </div>

                <label className="mt-3 block text-xs opacity-70">Día</label>
                <input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                />

                {loadingDay ? (
                  <div className="mt-3 text-sm opacity-70">Cargando detalle...</div>
                ) : !openingDay ? (
                  <div className="mt-3 text-sm opacity-70">
                    No hay arranque para este día. (Sin arranque no se puede calcular caja final.)
                  </div>
                ) : (
                  <>
                    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs uppercase tracking-widest opacity-70">Caja</div>
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-white/10 p-3">
                          <div className="text-xs opacity-70">ARS (inicio → fin)</div>
                          <div className="mt-1 text-sm font-semibold">
                            {fmtARS(openingDay.ars_open)} → {fmtARS(cashDay?.ars ?? openingDay.ars_open)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 p-3">
                          <div className="text-xs opacity-70">USD (inicio → fin)</div>
                          <div className="mt-1 text-sm font-semibold">
                            {fmtUSD(openingDay.usd_open)} → {fmtUSD(cashDay?.usd ?? openingDay.usd_open)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 text-xs opacity-70">
                        Fees: <b>{fmtARS(cashDay?.fees ?? 0)}</b> • Compraste: <b>{fmtUSD(cashDay?.usdBought ?? 0)}</b> • Vendiste: <b>{fmtUSD(cashDay?.usdSold ?? 0)}</b>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs uppercase tracking-widest opacity-70">Cierre guardado</div>
                      {!closingDay ? (
                        <div className="mt-2 text-sm opacity-70">No hay cierre guardado para este día.</div>
                      ) : (
                        <>
                          <div className="mt-2 text-lg font-semibold">{fmtARS(closingDay.pnl_total_ars)}</div>
                          <div className="mt-1 text-xs opacity-70">
                            Operativo: <b>{fmtARS(closingDay.pnl_operativo_ars)}</b> • Valuación: <b>{fmtARS(closingDay.pnl_valuacion_ars)}</b>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs uppercase tracking-widest opacity-70">Operaciones del día</div>
                      {opsDay.length === 0 ? (
                        <div className="mt-2 text-sm opacity-70">No hay operaciones para este día.</div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {opsDay.map((o) => (
                            <div key={o.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-medium">
                                  {o.op_type === "SELL_USD" ? "VENTA" : "COMPRA"} • {fmtUSD(o.usd_amount, 2)}
                                </div>
                                <div className="text-xs opacity-70">
                                  {new Date(o.op_time).toLocaleString()}
                                </div>
                              </div>
                              <div className="mt-1 text-xs opacity-70">
                                Precio: <b>{fmtARS(o.price_ars_per_usd)}</b> • ARS: <b>{fmtARS(o.ars_amount)}</b> • Fee: <b>{fmtARS(o.fee_ars ?? 0)}</b>
                              </div>
                              {o.client_name_snapshot ? (
                                <div className="mt-1 text-xs opacity-70">Cliente: {o.client_name_snapshot}</div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* LISTA CIERRES */}
              <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-4">
                <div className="text-xs uppercase tracking-widest opacity-70">Cierres guardados (30 días)</div>
                {closings.length === 0 ? (
                  <div className="mt-3 text-sm opacity-70">Todavía no hay cierres guardados.</div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {closings.map((c) => (
                      <div key={c.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{c.business_date}</div>
                          <div className="text-sm font-semibold">{fmtARS(c.pnl_total_ars)}</div>
                        </div>
                        <div className="mt-1 text-xs opacity-70">
                          Operativo: {fmtARS(c.pnl_operativo_ars)} • Valuación: {fmtARS(c.pnl_valuacion_ars)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-between">
                <a className="text-sm underline opacity-80 hover:opacity-100" href="/operaciones">← Operaciones</a>
                <a className="text-sm underline opacity-80 hover:opacity-100" href="/cierre">Cierre →</a>
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
