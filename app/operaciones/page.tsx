"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type ProfileRow = { id: string; email: string | null; tenant_id: string | null };
type BranchRow = { id: string; name: string; ars_default?: number; usd_default?: number };

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
  client_id?: string | null;
  client_name_snapshot: string | null;
};

type ClientRow = {
  id: string;
  tenant_id: string;
  name: string;
  full_name: string;
  phone: string | null;
  referred_by_text: string;
  created_at: string;
};

function todayLocalYYYYMMDD() {
  return new Date().toLocaleDateString("en-CA");
}
function num(v: string) {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : NaN;
}

// --- FORMATO es-AR ---
const nf0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtARS(n: number, decimals: 0 | 2 = 0) {
  const x = Number(n ?? 0);
  const body = decimals === 2 ? nf2.format(x) : nf0.format(x);
  return `$ ${body}`;
}
function fmtUSD(n: number, decimals: 0 | 2 = 0) {
  const x = Number(n ?? 0);
  const body = decimals === 2 ? nf2.format(x) : nf0.format(x);
  return `U$D ${body}`;
}
function fmtRateARSperUSD(n: number) {
  const x = Number(n ?? 0);
  return `$ ${nf2.format(x)}`;
}

function escQS(s: string) {
  return encodeURIComponent(s ?? "");
}

export default function OperacionesPage() {
  const [businessDate, setBusinessDate] = useState<string>(todayLocalYYYYMMDD());

  // Cierre del día (bloqueo)
  const [dayClosed, setDayClosed] = useState(false);
  const [closingInfo, setClosingInfo] = useState<any | null>(null);

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [opening, setOpening] = useState<DailyOpeningRow | null>(null);

  // Operaciones
  const [opsAll, setOpsAll] = useState<OperationRow[]>([]); // para cálculo caja
  const [ops, setOps] = useState<OperationRow[]>([]); // últimos 5 para UI

  // Clientes (selector)
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState<string>(""); // seleccionado
  const [clientQuery, setClientQuery] = useState<string>(""); // buscador

  // Cliente nuevo rápido (SOLO nombre)
  const [newClientName, setNewClientName] = useState<string>("");

  // Arranque
  const [arsOpen, setArsOpen] = useState<string>("");
  const [usdOpen, setUsdOpen] = useState<string>("");
  const [savingOpen, setSavingOpen] = useState(false);

  // Nueva operación
  const [opType, setOpType] = useState<"BUY_USD" | "SELL_USD">("SELL_USD");
  const [usdAmount, setUsdAmount] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [fee, setFee] = useState<string>("0");
  const [savingOp, setSavingOp] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const arsResultLive = useMemo(() => {
    const u = num(usdAmount);
    const p = num(price);
    if (!Number.isFinite(u) || !Number.isFinite(p)) return null;
    return u * p;
  }, [usdAmount, price]);

  const totals = useMemo(() => {
    if (!opening) return null;

    let ars = opening.ars_open;
    let usd = opening.usd_open;
    let fees = 0;

    let usdBought = 0,
      usdSold = 0;
    let arsPaid = 0,
      arsReceived = 0;

    for (const o of opsAll) {
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

      ars -= feeMov; // fee siempre resta ARS
    }

    return { ars, usd, fees, usdBought, usdSold, arsPaid, arsReceived };
  }, [opening, opsAll]);

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
      setOpsAll([]);
      setClients([]);
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

    // --- Clientes (selector) ---
    const { data: clientRows, error: clientsErr } = await supabase
      .from("clients")
      .select("id,tenant_id,name,full_name,phone,referred_by_text,created_at")
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: false })
      .limit(300);

    if (clientsErr) {
      console.error(clientsErr);
      setClients([]);
    } else {
      const rows = (clientRows ?? []) as ClientRow[];

      // "Cliente casual" arriba
      rows.sort((a, b) => {
        const aCasual = (a.name || "").toLowerCase() === "cliente casual" ? 0 : 1;
        const bCasual = (b.name || "").toLowerCase() === "cliente casual" ? 0 : 1;
        if (aCasual !== bCasual) return aCasual - bCasual;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setClients(rows);

      if (!clientId) {
        const casual = rows.find((c) => (c.name || "").toLowerCase() === "cliente casual");
        if (casual) setClientId(casual.id);
      }
    }

    // --- Branch ---
    const { data: branches, error: brErr } = await supabase
      .from("branches")
      .select("id,name,ars_default,usd_default")
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

    // --- ¿Día cerrado? ---
    const { data: existingClose, error: closeErr } = await supabase
      .from("daily_closings")
      .select("id,business_date,created_at")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("business_date", businessDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (closeErr) console.error(closeErr);

    setDayClosed(!!existingClose);
    setClosingInfo(existingClose ?? null);

    // --- Opening ---
    const { data: openRow, error: opErr } = await supabase
      .from("daily_openings")
      .select("id,business_date,ars_open,usd_open,branch_id")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("business_date", businessDate)
      .maybeSingle<DailyOpeningRow>();

    if (opErr) {
      console.error("daily_openings error:", opErr);
      setErrMsg(`No pude leer arranque del día (daily_openings): ${opErr?.message ?? ""}`);
      setLoading(false);
      return;
    }

    setOpening(openRow ?? null);

    if (!openRow) {
      setArsOpen(String(b.ars_default ?? 0));
      setUsdOpen(String(b.usd_default ?? 0));
      setOps([]);
      setOpsAll([]);
      setLoading(false);
      return;
    }

    const start = `${businessDate}T00:00:00-03:00`;
    const end = `${businessDate}T23:59:59-03:00`;

    // --- Operaciones del día (para caja + UI) ---
    const { data: opRowsAll, error: opsAllErr } = await supabase
      .from("operations")
      .select("id,op_time,op_type,usd_amount,price_ars_per_usd,ars_amount,fee_ars,client_id,client_name_snapshot")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("is_void", false)
      .gte("op_time", start)
      .lte("op_time", end)
      .order("op_time", { ascending: false })
      .limit(500);

    if (opsAllErr) {
      console.error(opsAllErr);
      setErrMsg("No pude leer operaciones (operations).");
      setLoading(false);
      return;
    }

    const rowsAll = (opRowsAll ?? []) as OperationRow[];
    setOpsAll(rowsAll);
    setOps(rowsAll.slice(0, 5));

    setLoading(false);
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessDate]);

  const signIn = async () => {
    const redirectTo = `${window.location.origin}/operaciones`;
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
    setOpening(null);
    setOps([]);
    setOpsAll([]);
    setClients([]);
  };

  const createOpening = async () => {
    if (!tenantId || !branch?.id) return;
    setErrMsg(null);

    const ars = num(arsOpen);
    const usd = num(usdOpen);

    if (!Number.isFinite(ars) || ars < 0) return setErrMsg("ARS inicial inválido.");
    if (!Number.isFinite(usd) || usd < 0) return setErrMsg("USD inicial inválido.");

    setSavingOpen(true);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;

    const { data, error } = await supabase
      .from("daily_openings")
      .insert({
        tenant_id: tenantId,
        branch_id: branch.id,
        opened_by: user?.id ?? null,
        business_date: businessDate,
        ars_open: ars,
        usd_open: usd,
      })
      .select("id,business_date,ars_open,usd_open,branch_id")
      .single<DailyOpeningRow>();

    setSavingOpen(false);

    if (error) {
      console.error(error);
      return setErrMsg("No pude guardar el arranque. ¿Ya existe uno para ese día?");
    }

    setOpening(data);
    setArsOpen("");
    setUsdOpen("");
    void loadAll();
  };

  function getSelectedClientName(): string | null {
    if (!clientId) return null;
    const c = clients.find((x) => x.id === clientId);
    return (c?.name || c?.full_name || "").trim() || null;
  }

  function isKnownClientName(name: string): boolean {
    const n = (name || "").trim().toLowerCase();
    if (!n) return false;
    return clients.some((c) => (c.name || c.full_name || "").trim().toLowerCase() === n);
  }

  const createOperation = async () => {
    if (dayClosed) {
      setErrMsg("Día cerrado. No podés cargar/editar operaciones. Para corregir necesitás Reabrir (Supervisor/Admin).");
      return;
    }
    if (!tenantId || !branch?.id || !opening) return;
    setErrMsg(null);

    const u = num(usdAmount);
    const p = num(price);
    const f = num(fee);

    if (!Number.isFinite(u) || u <= 0) return setErrMsg("USD inválido.");
    if (!Number.isFinite(p) || p <= 0) return setErrMsg("Precio inválido.");
    if (!Number.isFinite(f) || f < 0) return setErrMsg("Fee inválido.");

    // --- Cliente: puede ser seleccionado o un nombre nuevo ---
    const selectedName = getSelectedClientName();
    const typedNew = (newClientName || "").trim();

    // prioridad: si eligió clientId → usar ese
    const finalClientId = clientId || null;

    // snapshot: si hay clientId usamos su nombre, sino usamos el escrito (si hay)
    const snapshot = (selectedName || typedNew || "").trim() || null;

    setSavingOp(true);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;

    const { data, error } = await supabase
      .from("operations")
      .insert({
        tenant_id: tenantId,
        branch_id: branch.id,
        created_by: user?.id ?? null,
        client_id: finalClientId,
        client_name_snapshot: snapshot,
        op_type: opType,
        usd_amount: u,
        price_ars_per_usd: p,
        fee_ars: f,
        notes: null,
      })
      .select("id,op_time,op_type,usd_amount,price_ars_per_usd,ars_amount,fee_ars,client_id,client_name_snapshot")
      .single<OperationRow>();

    setSavingOp(false);

    if (error) {
      console.error(error);
      return setErrMsg("No pude guardar la operación.");
    }

    // reset
    setUsdAmount("");
    setPrice("");
    setFee("0");
    setClientQuery("");

    // Si eligió un cliente existente, dejamos el select como estaba.
    // Si estaba usando nombre nuevo, limpiamos el input.
    setNewClientName("");

    // refresco rápido UI
    setOpsAll((prev) => [data, ...prev]);
    setOps((prev) => [data, ...prev].slice(0, 5));

    // ✅ Si escribió un cliente nuevo que NO existe y NO eligió un clientId → mandarlo a /clients
    if (!finalClientId && typedNew && !isKnownClientName(typedNew)) {
      const url =
        `/clients?prefill_name=${escQS(typedNew)}` +
        `&prefill_phone=` +
        `&return_to=${escQS("/operaciones")}`;
      window.location.href = url;
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
        <div className="text-xs uppercase tracking-widest opacity-70">Control Cambio</div>
        <h1 className="mt-2 text-2xl font-semibold">Operaciones</h1>

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
            <button onClick={signIn} className="w-full rounded-xl border border-white/15 px-4 py-2 hover:bg-white/10">
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
                <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm">{errMsg}</div>
              ) : null}

              {!opening ? (
                <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-4">
                  <div className="text-xs uppercase tracking-widest opacity-70">Arranque del día</div>

                  <label className="mt-3 block text-xs opacity-70">ARS inicial</label>
                  <input
                    value={arsOpen}
                    onChange={(e) => setArsOpen(e.target.value)}
                    inputMode="decimal"
                    className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                  />

                  <label className="mt-3 block text-xs opacity-70">USD inicial</label>
                  <input
                    value={usdOpen}
                    onChange={(e) => setUsdOpen(e.target.value)}
                    inputMode="decimal"
                    className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                  />

                  <button
                    onClick={createOpening}
                    disabled={savingOpen}
                    className="mt-4 w-full rounded-xl border border-white/15 px-4 py-2 hover:bg-white/10 disabled:opacity-50"
                  >
                    {savingOpen ? "Guardando..." : "Guardar arranque"}
                  </button>
                </div>
              ) : (
                <>
                  {/* CAJA */}
                  <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-widest opacity-70">Caja en vivo</div>

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
                      Arranque: <b>{fmtARS(opening.ars_open)}</b> / <b>{fmtUSD(opening.usd_open)}</b> • Fees:{" "}
                      <b>{fmtARS(totals?.fees ?? 0, 2)}</b>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <a className="flex-1 text-center rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10" href="/cierre">
                        Ir a Cierre
                      </a>
                      <a className="flex-1 text-center rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10" href="/reporte">
                        Ir a Reporte
                      </a>
                    </div>
                  </div>

                  {/* NUEVA OPERACIÓN */}
                  <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-4">
                    <div className="text-xs uppercase tracking-widest opacity-70">Nueva operación</div>

                    <label className="mt-3 block text-xs opacity-70">Tipo</label>
                    <select
                      value={opType}
                      onChange={(e) => setOpType(e.target.value as any)}
                      className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                    >
                      <option value="SELL_USD">VENTA (yo vendo USD)</option>
                      <option value="BUY_USD">COMPRA (yo compro USD)</option>
                    </select>

                    <label className="mt-3 block text-xs opacity-70">USD</label>
                    <input
                      value={usdAmount}
                      onChange={(e) => setUsdAmount(e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                      placeholder="Ej: 100"
                    />

                    <label className="mt-3 block text-xs opacity-70">Precio ARS/USD</label>
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                      placeholder="Ej: 1500"
                    />

                    <div className="mt-2 text-xs opacity-70">
                      ARS resultante: <b>{arsResultLive ? fmtARS(arsResultLive, 2) : "-"}</b>
                    </div>

                    <label className="mt-3 block text-xs opacity-70">Fee (ARS)</label>
                    <input
                      value={fee}
                      onChange={(e) => setFee(e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                    />

                    {/* CLIENTE EXISTENTE */}
                    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs uppercase tracking-widest opacity-70">Cliente frecuente</div>

                      <input
                        value={clientQuery}
                        onChange={(e) => setClientQuery(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                        placeholder="Buscar por nombre / teléfono / referencia"
                      />

                      <div className="mt-2 rounded-xl border border-white/10 bg-black/20">
                        <select
                          value={clientId}
                          onChange={(e) => {
                            setClientId(e.target.value);
                            // si elige cliente existente, limpian modo "nuevo"
                            setNewClientName("");
                          }}
                          className="w-full bg-transparent px-3 py-2 outline-none"
                        >
                          <option value="">(Sin cliente)</option>

                          {clients
                            .filter((c) => {
                              const q = (clientQuery || "").toLowerCase().trim();
                              if (!q) return true;
                              return (
                                (c.name || c.full_name || "").toLowerCase().includes(q) ||
                                (c.phone || "").toLowerCase().includes(q) ||
                                (c.referred_by_text || "").toLowerCase().includes(q)
                              );
                            })
                            .slice(0, 30)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {(c.name || c.full_name) +
                                  (c.phone ? ` • ${c.phone}` : "") +
                                  ((c.name || c.full_name || "").toLowerCase() === "cliente casual" ? " (casual)" : "")}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>

                    {/* CLIENTE NUEVO RÁPIDO (SOLO NOMBRE) */}
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-xs uppercase tracking-widest opacity-70">Cliente nuevo (rápido)</div>
                      <div className="mt-2 text-xs opacity-70">
                        Escribí solo el nombre. Al guardar la operación te llevará a <b>Clientes</b> para cargar referencia (obligatoria) y teléfono
                        (opcional).
                      </div>

                      <input
                        value={newClientName}
                        onChange={(e) => {
                          setNewClientName(e.target.value);
                          // si empieza a escribir un nuevo cliente, deselecciona el existente
                          if (e.target.value.trim()) setClientId("");
                        }}
                        className="mt-2 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                        placeholder="Ej: Juan Pérez"
                      />
                    </div>

                    <button
                      onClick={createOperation}
                      disabled={savingOp || dayClosed}
                      className="mt-4 w-full rounded-xl border border-white/15 px-4 py-2 hover:bg-white/10 disabled:opacity-50"
                    >
                      {savingOp ? "Guardando..." : "Guardar operación"}
                    </button>

                    {dayClosed ? (
                      <div className="mt-2 text-xs opacity-70">
                        🔒 Día cerrado. Para cargar/editar operaciones necesitás <b>Reabrir</b> (Supervisor/Admin).
                      </div>
                    ) : null}
                  </div>

                  {/* LISTA */}
                  <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-4">
                    <div className="text-xs uppercase tracking-widest opacity-70">Últimas 5 operaciones</div>

                    {ops.length === 0 ? (
                      <div className="mt-3 text-sm opacity-70">No hay operaciones para este día.</div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {ops.map((o) => (
                          <div key={o.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium">
                                {o.op_type === "SELL_USD" ? "VENTA" : "COMPRA"} • {fmtUSD(o.usd_amount)}
                              </div>
                              <div className="text-xs opacity-70">{new Date(o.op_time).toLocaleString()}</div>
                            </div>
                            <div className="mt-1 text-xs opacity-70">
                              Precio: {fmtRateARSperUSD(o.price_ars_per_usd)} • ARS: {fmtARS(o.ars_amount)} • Fee: {fmtARS(o.fee_ars ?? 0, 2)}
                            </div>
                            {o.client_name_snapshot ? <div className="mt-1 text-xs opacity-70">Cliente: {o.client_name_snapshot}</div> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="mt-6 flex justify-between">
                <a className="text-sm underline opacity-80 hover:opacity-100" href="/">
                  ← Dashboard
                </a>
                <button
                  onClick={signOut}
                  className="text-sm rounded-xl border border-white/10 px-3 py-2 opacity-80 hover:bg-white/5"
                >
                  Cerrar sesión
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
