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
function num(v: string) {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : NaN;
}

// --- FORMATO es-AR (opción A) ---
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

export default function CierrePage() {
  const [businessDate, setBusinessDate] = useState<string>(todayLocalYYYYMMDD());

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [branch, setBranch] = useState<BranchRow | null>(null);

  const [opening, setOpening] = useState<DailyOpeningRow | null>(null);
  const [ops, setOps] = useState<OperationRow[]>([]);
  const [closingSaved, setClosingSaved] = useState<DailyClosingRow | null>(null);

  const [precioVenta, setPrecioVenta] = useState<string>("1450");
  const [precioCompra, setPrecioCompra] = useState<string>("1500");

  const [savingClose, setSavingClose] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const totals = useMemo(() => {
    if (!opening) return null;

    let ars = opening.ars_open;
    let usd = opening.usd_open;
    let fees = 0;

    let usdBought = 0, arsPaid = 0;
    let usdSold = 0, arsReceived = 0;

    for (const o of ops) {
      const feeMov = o.fee_ars ?? 0;
      fees += feeMov;

      if (o.op_type === "SELL_USD") {
        ars += o.ars_amount;
        usd -= o.usd_amount;
        usdSold += o.usd_amount;
        arsReceived += o.ars_amount;
      } else {
        ars -= o.ars_amount;
        usd += o.usd_amount;
        usdBought += o.usd_amount;
        arsPaid += o.ars_amount;
      }
      ars -= feeMov;
    }

    return { ars, usd, fees, usdBought, usdSold, arsPaid, arsReceived };
  }, [opening, ops]);

  const closeCalc = useMemo(() => {
    if (!opening || !totals) return null;

    const venta = num(precioVenta);
    const compra = num(precioCompra);
    if (!Number.isFinite(venta) || !Number.isFinite(compra) || venta <= 0 || compra <= 0) return null;

    const equityOpen = opening.ars_open + opening.usd_open * venta;

    const usdFinal = totals.usd;
    const equityClose =
      usdFinal >= 0 ? totals.ars + usdFinal * venta : totals.ars + usdFinal * compra;

    const pnlTotal = equityClose - equityOpen;

    const pnlOperativo =
  (totals.arsReceived - totals.arsPaid) - totals.fees - (totals.usdSold - totals.usdBought) * compra;
    const pnlValuacion = pnlTotal - pnlOperativo;

    return { venta, compra, equityOpen, equityClose, pnlTotal, pnlOperativo, pnlValuacion };
  }, [opening, totals, precioVenta, precioCompra, ops]);

  const loadAll = async () => {
    setLoading(true);
    setErrMsg(null);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;

    if (!user) {
      setEmail(null);
      setTenantId(null);
      setBranch(null);
      setOpening(null);
      setOps([]);
      setClosingSaved(null);
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
    
    // ¿El día ya está cerrado? (si existe, bloqueamos y mostramos el cierre)
if (tenantId && b?.id && businessDate) {
  const { data: existingClose, error: closeErr } = await supabase
    .from("daily_closings")
    .select("id,business_date,pnl_total_ars,pnl_operativo_ars,pnl_valuacion_ars,created_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", b.id)
    .eq("business_date", businessDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (closeErr) console.error(closeErr);

  if (existingClose) {
  setClosingSaved(existingClose);
} else {
  setClosingSaved(null);
}
}

    if (!b) {
      setErrMsg("No tenés sucursales creadas.");
      setLoading(false);
      return;
    }

    const { data: openRow, error: opErr } = await supabase
      .from("daily_openings")
      .select("id,business_date,ars_open,usd_open,branch_id")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("business_date", businessDate)
      .maybeSingle<DailyOpeningRow>();

    if (opErr) {
      console.error(opErr);
      setErrMsg("No pude leer arranque del día (daily_openings).");
      setLoading(false);
      return;
    }

    setOpening(openRow ?? null);

    const start = new Date(`${businessDate}T00:00:00-03:00`).toISOString();
const end = new Date(`${businessDate}T23:59:59-03:00`).toISOString();

    const { data: opRows, error: opsErr } = await supabase
      .from("operations")
      .select("id,op_time,op_type,usd_amount,price_ars_per_usd,ars_amount,fee_ars,client_name_snapshot")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("is_void", false)
      .gte("op_time", start)
      .lte("op_time", end)
      .order("op_time", { ascending: true })
      .limit(500);

    if (opsErr) {
      console.error(opsErr);
      setErrMsg("No pude leer operaciones (operations).");
      setLoading(false);
      return;
    }

    setOps((opRows ?? []) as OperationRow[]);

    const { data: closRows } = await supabase
      .from("daily_closings")
      .select("id,business_date,pnl_total_ars,pnl_operativo_ars,pnl_valuacion_ars,created_at")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("business_date", businessDate)
      .limit(1);

    setClosingSaved((closRows?.[0] ?? null) as DailyClosingRow | null);

    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessDate]);

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/cierre" },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setEmail(null);
    setTenantId(null);
    setBranch(null);
    setOpening(null);
    setOps([]);
    setClosingSaved(null);
  };

  const closeDay = async () => {
    if (!tenantId || !branch?.id || !opening || !totals || !closeCalc) return;
    setErrMsg(null);

    setSavingClose(true);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;

    const payload = {
      tenant_id: tenantId,
      branch_id: branch.id,
      business_date: businessDate,

      price_sell: closeCalc.venta,
      price_buy: closeCalc.compra,

      ars_open: opening.ars_open,
      usd_open: opening.usd_open,
      ars_close: totals.ars,
      usd_close: totals.usd,

      usd_bought: totals.usdBought,
      usd_sold: totals.usdSold,
      fees_ars: totals.fees,

      equity_open_ars: closeCalc.equityOpen,
      equity_close_ars: closeCalc.equityClose,
      pnl_total_ars: closeCalc.pnlTotal,
      pnl_operativo_ars: closeCalc.pnlOperativo,
      pnl_valuacion_ars: closeCalc.pnlValuacion,

      created_by: user?.id ?? null,
    };

    const { data, error } = await supabase
      .from("daily_closings")
      .upsert(payload, { onConflict: "tenant_id,branch_id,business_date" })
      .select("id,business_date,pnl_total_ars,pnl_operativo_ars,pnl_valuacion_ars,created_at")
      .single<DailyClosingRow>();

    setSavingClose(false);

    if (error) {
      console.error(error);
      return setErrMsg("No pude guardar el cierre (daily_closings).");
    }

    setClosingSaved(data);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
        <div className="text-xs uppercase tracking-widest opacity-70">Control Cambio</div>
        <h1 className="mt-2 text-2xl font-semibold">Cierre del día</h1>

        <div className="mt-3 text-sm opacity-70">
          <div>Día operativo:</div>
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
          />
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

              {!opening ? (
                <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-4 text-sm opacity-70">
                  No hay arranque guardado para este día. Primero cargá el arranque en Operaciones.
                </div>
              ) : (
                <>
                  <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-widest opacity-70">Caja final (preview)</div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 p-3">
                        <div className="text-xs opacity-70">ARS</div>
                        <div className="mt-1 text-lg font-semibold">{fmtARS(totals?.ars ?? 0)}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 p-3">
                        <div className="text-xs opacity-70">USD</div>
                        <div className="mt-1 text-lg font-semibold">{fmtUSD(totals?.usd ?? 0)}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs opacity-70">
                      Fees: <b>{fmtARS(totals?.fees ?? 0)}</b> • Compraste: <b>{fmtUSD(totals?.usdBought ?? 0)}</b> • Vendiste: <b>{fmtUSD(totals?.usdSold ?? 0)}</b>
                    </div>
                  </div>

                  <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-4">
                    <div className="text-xs uppercase tracking-widest opacity-70">Precios de referencia</div>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs opacity-70">Precio de VENTA</label>
                        <input value={precioVenta} onChange={(e) => setPrecioVenta(e.target.value)} inputMode="decimal"
                          className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs opacity-70">Precio de COMPRA</label>
                        <input value={precioCompra} onChange={(e) => setPrecioCompra(e.target.value)} inputMode="decimal"
                          className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none" />
                      </div>
                    </div>

                    {/* RESULTADO DEL DÍA (por moneda) */}
<div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
  <div className="text-xs uppercase tracking-widest opacity-70">Resultado del día</div>

  {(!opening || !totals) ? (
    <div className="mt-2 text-sm opacity-70">Cargá el arranque y operaciones para ver el resultado.</div>
  ) : (
    <>
      {(() => {
        const deltaArs = (totals.ars ?? 0) - (opening.ars_open ?? 0);
        const deltaUsd = (totals.usd ?? 0) - (opening.usd_open ?? 0);

        return (
          <>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 p-3">
                <div className="text-xs opacity-70">Resultado ARS</div>
                <div className="mt-1 text-lg font-semibold">{fmtARS(deltaArs, 2)}</div>
              </div>
              <div className="rounded-xl border border-white/10 p-3">
                <div className="text-xs opacity-70">Resultado USD</div>
                <div className="mt-1 text-lg font-semibold">{fmtUSD(deltaUsd, 2)}</div>
              </div>
            </div>

            <div className="mt-2 text-xs opacity-70">
              Caja inicial: <b>{fmtARS(opening.ars_open, 2)}</b> / <b>{fmtUSD(opening.usd_open, 2)}</b>
              {" • "}
              Caja final: <b>{fmtARS(totals.ars, 2)}</b> / <b>{fmtUSD(totals.usd, 2)}</b>
            </div>
          </>
        );
      })()}
    </>
  )}
</div>

{/* VALUACIÓN (opcional, con precios) */}
<div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
  <div className="text-xs uppercase tracking-widest opacity-70">Valuación (opcional)</div>
  {!closeCalc ? (
    <div className="mt-2 text-sm opacity-70">Completá precios válidos para ver la valuación.</div>
  ) : (
    <>
      <div className="mt-2 text-xs opacity-70">
        Patrimonio inicial: <b>{fmtARS(closeCalc.equityOpen)}</b> • Patrimonio final: <b>{fmtARS(closeCalc.equityClose)}</b>
      </div>
      <div className="mt-2 text-lg font-semibold">Valuación total (ARS): {fmtARS(closeCalc.pnlTotal)}</div>
      <div className="mt-1 text-xs opacity-70">
        Operativo: <b>{fmtARS(closeCalc.pnlOperativo)}</b> • Valuación: <b>{fmtARS(closeCalc.pnlValuacion)}</b>
      </div>
    </>
  )}
</div>

                    <button
                      onClick={closeDay}
                      disabled={savingClose || !closeCalc || !!closingSaved}
                      className="mt-4 w-full rounded-xl border border-white/15 px-4 py-2 hover:bg-white/10 disabled:opacity-50"
                    >
                      {savingClose ? "Guardando..." : "Cerrar el día (guardar)"}
                    </button>
              {closingSaved ? (
  <div className="mt-3 text-xs opacity-70">
    🔒 Día cerrado. Para corregir operaciones necesitás <b>Reabrir</b> (solo Supervisor/Admin).
  </div>
) : null}
                    {closingSaved ? (
                      <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">
                        ✅ Cierre guardado. P&L total: <b>{fmtARS(closingSaved.pnl_total_ars)}</b>
                        <div className="mt-1 text-xs opacity-70">
                          Operativo: {fmtARS(closingSaved.pnl_operativo_ars)} • Valuación: {fmtARS(closingSaved.pnl_valuacion_ars)}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-6 flex justify-between">
                    <a className="text-sm underline opacity-80 hover:opacity-100" href="/operaciones">← Volver a Operaciones</a>
                    <a className="text-sm underline opacity-80 hover:opacity-100" href="/reporte">Ir a Reporte →</a>
                  </div>
                </>
              )}

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
