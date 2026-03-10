"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AppPageHeader } from "@/app/components/app-page-header";
import { canCorrectDay, getProfileWithRole, type AppRole } from "@/lib/security";

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
function fmtDateTimeAR(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    hour12: false,
  });
}
function clientDisplayName(c: ClientRow) {
  return (c.full_name || c.name || "").trim();
}
function escQS(s: string) {
  return encodeURIComponent(s ?? "");
}

export default function OperacionesPage() {
  const [businessDate, setBusinessDate] = useState<string>(todayLocalYYYYMMDD());
  const [dayClosed, setDayClosed] = useState(false);

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [role, setRole] = useState<AppRole>("operator");
  const [roleColumnAvailable, setRoleColumnAvailable] = useState(true);
  const router = useRouter();

  const [ops, setOps] = useState<OperationRow[]>([]);
  const [allDayOps, setAllDayOps] = useState<OperationRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [opening, setOpening] = useState<DailyOpeningRow | null>(null);

  const [clientInput, setClientInput] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");

  const [opType, setOpType] = useState<"BUY_USD" | "SELL_USD">("SELL_USD");
  const [usdAmount, setUsdAmount] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("0");
  const [savingOp, setSavingOp] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const clientListboxId = "client-suggestions-listbox";

  const canCorrect = useMemo(() => canCorrectDay(role), [role]);
  const hasOpening = !!opening;

  const casualClient = useMemo(
    () => clients.find((c) => clientDisplayName(c).toLowerCase() === "cliente casual") ?? null,
    [clients]
  );
  const selectedClientName = useMemo(() => {
    const selected = clients.find((c) => c.id === selectedClientId);
    return selected ? clientDisplayName(selected).toLowerCase() : "";
  }, [clients, selectedClientId]);

  const clientMatches = useMemo(() => {
    const q = clientInput.trim().toLowerCase();
    if (!q) return [];
    return clients
      .filter((c) => {
        const name = clientDisplayName(c).toLowerCase();
        return (
          name.includes(q) ||
          (c.phone || "").toLowerCase().includes(q) ||
          (c.referred_by_text || "").toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [clientInput, clients]);
  const showClientMatches = useMemo(() => {
    const q = clientInput.trim().toLowerCase();
    if (!q) return false;
    if (selectedClientName && q === selectedClientName) return false;
    return clientMatches.length > 0;
  }, [clientInput, selectedClientName, clientMatches]);

  const arsResultLive = useMemo(() => {
    const u = num(usdAmount);
    const p = num(price);
    if (!Number.isFinite(u) || !Number.isFinite(p)) return null;
    return u * p;
  }, [usdAmount, price]);

  const cashLive = useMemo(() => {
    if (!opening) return null;
    let ars = Number(opening.ars_open ?? 0);
    let usd = Number(opening.usd_open ?? 0);
    let fees = 0;
    for (const o of allDayOps) {
      const feeValue = Number(o.fee_ars ?? 0);
      fees += feeValue;
      if (o.op_type === "SELL_USD") {
        ars += Number(o.ars_amount ?? 0);
        usd -= Number(o.usd_amount ?? 0);
      } else {
        ars -= Number(o.ars_amount ?? 0);
        usd += Number(o.usd_amount ?? 0);
      }
      ars -= feeValue;
    }
    return { ars, usd, fees };
  }, [opening, allDayOps]);

  const loadAll = async () => {
    setLoading(true);
    setErrMsg(null);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;

    if (!user) {
      setEmail(null);
      setTenantId(null);
      setBranch(null);
      setOps([]);
      setAllDayOps([]);
      setClients([]);
      setOpening(null);
      setLoading(false);
      return;
    }

    setEmail(user.email ?? null);

    const profile = await getProfileWithRole(user.id);
    setRole(profile.role);
    setRoleColumnAvailable(profile.roleColumnAvailable);

    if (profile.error || !profile.tenant_id) {
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

    const { data: existingClose, error: closeErr } = await supabase
      .from("daily_closings")
      .select("id")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("business_date", businessDate)
      .limit(1)
      .maybeSingle();

    if (closeErr) console.error(closeErr);
    setDayClosed(!!existingClose);

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
      rows.sort((a, b2) => {
        const aCasual = clientDisplayName(a).toLowerCase() === "cliente casual" ? 0 : 1;
        const bCasual = clientDisplayName(b2).toLowerCase() === "cliente casual" ? 0 : 1;
        if (aCasual !== bCasual) return aCasual - bCasual;
        return new Date(b2.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setClients(rows);
      if (!selectedClientId) {
        const casual = rows.find((c) => clientDisplayName(c).toLowerCase() === "cliente casual");
        if (casual) {
          setSelectedClientId(casual.id);
          setClientInput("");
        }
      }
    }

    const start = `${businessDate}T00:00:00-03:00`;
    const end = `${businessDate}T23:59:59-03:00`;

    const { data: openingRow, error: openingErr } = await supabase
      .from("daily_openings")
      .select("id,business_date,ars_open,usd_open,branch_id")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("business_date", businessDate)
      .maybeSingle<DailyOpeningRow>();

    if (openingErr) {
      console.error(openingErr);
      setErrMsg("No pude leer caja inicial (daily_openings).");
      setLoading(false);
      return;
    }

    setOpening(openingRow ?? null);

    const { data: opRows, error: opsErr } = await supabase
      .from("operations")
      .select("id,op_time,op_type,usd_amount,price_ars_per_usd,ars_amount,fee_ars,client_id,client_name_snapshot")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("is_void", false)
      .gte("op_time", start)
      .lte("op_time", end)
      .order("op_time", { ascending: false })
      .limit(500);

    if (opsErr) {
      console.error(opsErr);
      setErrMsg("No pude leer operaciones (operations).");
      setLoading(false);
      return;
    }

    const allOps = (opRows ?? []) as OperationRow[];
    setAllDayOps(allOps);
    setOps(allOps.slice(0, 5));
    const defaultBusinessName = (b?.name || "").trim().toLowerCase();
    const needsSetup = !!b && (!b.name?.trim() || defaultBusinessName === "sucursal principal");
    if (needsSetup || !openingRow) {
      router.replace(`/inicio-dia?date=${encodeURIComponent(businessDate)}`);
    }
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
    setOps([]);
    setAllDayOps([]);
    setClients([]);
    setOpening(null);
  };

  const selectClient = (client: ClientRow) => {
    setSelectedClientId(client.id);
    setClientInput(clientDisplayName(client));
  };

  const createOperation = async () => {
    if (dayClosed) {
      setErrMsg("Día cerrado. No podés cargar operaciones.");
      return;
    }
    if (!opening) {
      setErrMsg("Primero guardá la caja inicial del día.");
      return;
    }
    if (!tenantId || !branch?.id) return;
    setErrMsg(null);

    const u = num(usdAmount);
    const p = num(price);
    const f = num(fee);

    if (!Number.isFinite(u) || u <= 0) return setErrMsg("USD inválido.");
    if (!Number.isFinite(p) || p <= 0) return setErrMsg("Precio inválido.");
    if (!Number.isFinite(f) || f < 0) return setErrMsg("Fee inválido.");

    const typedName = clientInput.trim();
    const selected = clients.find((c) => c.id === selectedClientId) ?? null;

    let finalClientId: string | null = null;
    let snapshot: string | null = null;

    if (selected && typedName.toLowerCase() === clientDisplayName(selected).toLowerCase()) {
      finalClientId = selected.id;
      snapshot = clientDisplayName(selected);
    } else if (typedName) {
      const exactKnown = clients.find(
        (c) => clientDisplayName(c).toLowerCase() === typedName.toLowerCase()
      );
      if (exactKnown) {
        finalClientId = exactKnown.id;
        snapshot = clientDisplayName(exactKnown);
      } else {
        finalClientId = null;
        snapshot = typedName;
      }
    } else if (casualClient) {
      finalClientId = casualClient.id;
      snapshot = clientDisplayName(casualClient);
    } else {
      return setErrMsg("Ingresá un cliente o usá Cliente casual.");
    }

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

    setUsdAmount("");
    setPrice("");
    setFee("0");
    if (casualClient) {
      setSelectedClientId(casualClient.id);
      setClientInput("");
    } else {
      setSelectedClientId("");
      setClientInput("");
    }

    setOps((prev) => [data, ...prev].slice(0, 5));
    setAllDayOps((prev) => [data, ...prev]);

    if (!finalClientId && snapshot) {
      const wantsToAddClient = window.confirm(
        `Operación guardada para "${snapshot}".\n\n¿Querés crear ahora la ficha del cliente?`
      );
      if (wantsToAddClient) {
        const url =
          `/clients?prefill_name=${escQS(snapshot)}` +
          `&prefill_phone=` +
          `&return_to=${escQS("/operaciones")}`;
        window.location.href = url;
      }
    }
  };

  const voidOperation = async (opId: string) => {
    if (!canCorrect || !tenantId || !branch?.id) return;
    const ok = window.confirm("¿Anular esta operación?");
    if (!ok) return;
    const { error } = await supabase
      .from("operations")
      .update({ is_void: true })
      .eq("tenant_id", tenantId)
      .eq("branch_id", branch.id)
      .eq("id", opId);
    if (error) {
      console.error(error);
      setErrMsg("No pude anular la operación.");
      return;
    }
    setOps((prev) => prev.filter((o) => o.id !== opId));
  };

  const reopenDay = async () => {
    if (!canCorrect || !tenantId || !branch?.id) return;
    const ok = window.confirm(`¿Reabrir el día ${businessDate}? Se desbloquearán operaciones y cierre.`);
    if (!ok) return;
    const { error } = await supabase
      .from("daily_closings")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("branch_id", branch.id)
      .eq("business_date", businessDate);
    if (error) {
      console.error(error);
      setErrMsg("No pude reabrir el día.");
      return;
    }
    setDayClosed(false);
  };

  return (
    <main className="cc-app min-h-screen flex items-start justify-center px-3 py-4 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-5 md:max-w-2xl lg:max-w-3xl">
        <AppPageHeader title="Operaciones" activeTab="operaciones" role={role} />

        <div className="mt-3 flex items-center justify-between gap-3 text-xs opacity-70">
          <span>Día operativo</span>
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            className="rounded-lg border border-white/15 bg-transparent px-2 py-1 outline-none"
          />
        </div>

        <div className="mt-3">
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
              {!roleColumnAvailable ? (
                <div className="mb-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs">
                  Roles no configurados en DB. Se usará modo compatibilidad hasta agregar columna <b>profiles.role</b>.
                </div>
              ) : null}

              {errMsg ? (
                <div role="alert" aria-live="assertive" className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm">
                  {errMsg}
                </div>
              ) : null}

              {dayClosed ? (
                <div role="status" aria-live="polite" className="mb-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs">
                  Día cerrado para {businessDate}. No se pueden cargar operaciones.
                  {canCorrect ? (
                    <button
                      onClick={reopenDay}
                      className="ml-2 rounded-lg border border-yellow-300/30 px-2 py-1 text-[11px] hover:bg-yellow-500/20"
                    >
                      Reabrir día
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="mb-3 rounded-xl border border-white/10 p-4">
                <div className="text-xs uppercase tracking-widest opacity-70">Caja en vivo</div>
                {hasOpening ? (
                  <>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 p-3">
                        <div className="text-xs opacity-70">ARS</div>
                        <div className="mt-1 text-lg font-semibold">{fmtARS(cashLive?.ars ?? 0, 2)}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 p-3">
                        <div className="text-xs opacity-70">USD</div>
                        <div className="mt-1 text-lg font-semibold">{fmtUSD(cashLive?.usd ?? 0, 2)}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs opacity-70">
                      Arranque: <b>{fmtARS(opening.ars_open, 2)}</b> / <b>{fmtUSD(opening.usd_open, 2)}</b> • Fees:{" "}
                      <b>{fmtARS(cashLive?.fees ?? 0, 2)}</b>
                    </div>
                  </>
                ) : (
                  <div className="mt-2 text-xs opacity-70">
                    Falta iniciar el día.{" "}
                    <Link href={`/inicio-dia?date=${encodeURIComponent(businessDate)}`} className="underline">
                      Ir a Inicio del día
                    </Link>
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-white/10 p-4">
                  <div className="text-xs uppercase tracking-widest opacity-70">Nueva operación</div>

                  <label className="mt-3 block text-xs opacity-70">Tipo</label>
                  <select
                    value={opType}
                    onChange={(e) => setOpType(e.target.value as "BUY_USD" | "SELL_USD")}
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

                  <label className="mt-3 block text-xs opacity-70">Cliente</label>
                  <input
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showClientMatches}
                    aria-controls={clientListboxId}
                    value={clientInput}
                    onChange={(e) => {
                      setClientInput(e.target.value);
                      setSelectedClientId("");
                    }}
                    className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                    placeholder="Escribí nombre, teléfono o referencia"
                  />

                  {showClientMatches ? (
                    <div id={clientListboxId} role="listbox" className="mt-2 rounded-xl border border-white/10 p-2">
                      <div className="space-y-1">
                        {clientMatches.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            role="option"
                            aria-selected={selectedClientId === c.id}
                            onClick={() => selectClient(c)}
                            className="block w-full rounded-lg border border-white/10 px-2 py-1 text-left text-xs hover:bg-white/10"
                          >
                            {clientDisplayName(c)} {c.phone ? `• ${c.phone}` : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-2 text-xs opacity-70">Si no existe, se guarda el nombre y luego podés crearlo en Clientes.</div>

                  <button
                    onClick={createOperation}
                    disabled={savingOp || dayClosed || !hasOpening}
                    className="mt-4 w-full rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    {savingOp ? "Guardando..." : "Guardar operación"}
                  </button>
                </div>

                <div className="rounded-xl border border-white/10 p-4">
                  <div className="text-xs uppercase tracking-widest opacity-70">Últimas 5 operaciones</div>

                  {ops.length === 0 ? (
                    <div className="mt-3 text-sm opacity-70">No hay operaciones para este día.</div>
                  ) : (
                    <div className="mt-3 divide-y divide-white/10 rounded-xl border border-white/10">
                      {ops.map((o) => (
                        <div key={o.id} className="p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium">
                              {o.op_type === "SELL_USD" ? "VENTA" : "COMPRA"} • {fmtUSD(o.usd_amount)}
                            </div>
                            <div className="text-xs opacity-70">{fmtDateTimeAR(o.op_time)}</div>
                          </div>
                          <div className="mt-1 text-xs opacity-70">
                            Precio: {fmtRateARSperUSD(o.price_ars_per_usd)} • ARS: {fmtARS(o.ars_amount)} • Fee: {fmtARS(o.fee_ars ?? 0, 2)}
                          </div>
                          {o.client_name_snapshot ? (
                            <div className="mt-1 text-xs opacity-70">Cliente: {o.client_name_snapshot}</div>
                          ) : null}
                          {canCorrect ? (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => voidOperation(o.id)}
                                className="rounded-lg border border-red-400/30 px-2 py-1 text-[11px] text-red-100 hover:bg-red-500/20"
                              >
                                Anular operación
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 flex justify-end">
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
