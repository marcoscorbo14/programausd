"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { AppPageHeader } from "@/app/components/app-page-header";
import { canManageTeam, getProfileWithRole, type AppRole } from "@/lib/security";

type BranchRow = { id: string; name: string };
type DailyOpeningRow = {
  id: string;
  business_date: string;
  ars_open: number;
  usd_open: number;
  branch_id: string | null;
};

function todayLocalYYYYMMDD() {
  return new Date().toLocaleDateString("en-CA");
}

function num(v: string) {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : NaN;
}

const nf2 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmtARS(n: number) {
  return `$ ${nf2.format(Number(n ?? 0))}`;
}
function fmtUSD(n: number) {
  return `U$D ${nf2.format(Number(n ?? 0))}`;
}

export default function InicioDiaPage() {
  const router = useRouter();
  const [businessDate, setBusinessDate] = useState<string>(todayLocalYYYYMMDD());
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [role, setRole] = useState<AppRole>("operator");
  const [opening, setOpening] = useState<DailyOpeningRow | null>(null);
  const [dayClosed, setDayClosed] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [openingArsInput, setOpeningArsInput] = useState("");
  const [openingUsdInput, setOpeningUsdInput] = useState("");
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [savingOpening, setSavingOpening] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const needsBusinessSetup = useMemo(() => {
    const normalized = (branch?.name || "").trim().toLowerCase();
    return !normalized || normalized === "sucursal principal";
  }, [branch]);

  const loadAll = async () => {
    setLoading(true);
    setErrMsg(null);
    setOkMsg(null);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) {
      setEmail(null);
      setLoading(false);
      return;
    }

    setEmail(user.email ?? null);
    const profile = await getProfileWithRole(user.id);
    setRole(profile.role);
    if (profile.error || !profile.tenant_id) {
      setErrMsg("No pude leer tu perfil.");
      setLoading(false);
      return;
    }
    setTenantId(profile.tenant_id);

    const { data: branches, error: branchErr } = await supabase
      .from("branches")
      .select("id,name")
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: true })
      .limit(1);
    if (branchErr) {
      console.error(branchErr);
      setErrMsg("No pude leer sucursal.");
      setLoading(false);
      return;
    }
    const b = branches?.[0] ?? null;
    setBranch(b);
    setBusinessName(b?.name ?? "");
    if (!b) {
      setErrMsg("No tenés sucursal creada.");
      setLoading(false);
      return;
    }

    const { data: closeRow } = await supabase
      .from("daily_closings")
      .select("id")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("business_date", businessDate)
      .limit(1)
      .maybeSingle();
    setDayClosed(!!closeRow);

    const { data: openingRow, error: openingErr } = await supabase
      .from("daily_openings")
      .select("id,business_date,ars_open,usd_open,branch_id")
      .eq("tenant_id", profile.tenant_id)
      .eq("branch_id", b.id)
      .eq("business_date", businessDate)
      .maybeSingle<DailyOpeningRow>();
    if (openingErr) {
      console.error(openingErr);
      setErrMsg("No pude leer caja inicial.");
      setLoading(false);
      return;
    }
    setOpening(openingRow ?? null);
    setLoading(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get("date");
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      setBusinessDate(dateParam);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessDate]);

  const signIn = async () => {
    const redirectTo = `${window.location.origin}/inicio-dia`;
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  };

  const saveBusinessName = async () => {
    if (!tenantId || !branch?.id) return;
    if (!canManageTeam(role)) {
      setErrMsg("Solo owner/admin puede configurar el nombre del negocio.");
      return;
    }
    const trimmed = businessName.trim();
    if (!trimmed) return setErrMsg("Ingresá un nombre válido.");
    setSavingBusiness(true);
    setErrMsg(null);
    const { error } = await supabase
      .from("branches")
      .update({ name: trimmed })
      .eq("tenant_id", tenantId)
      .eq("id", branch.id);
    setSavingBusiness(false);
    if (error) {
      console.error(error);
      setErrMsg("No pude guardar el nombre del negocio.");
      return;
    }
    setBranch({ ...branch, name: trimmed });
    setOkMsg("Nombre del negocio guardado.");
  };

  const saveOpening = async () => {
    if (!tenantId || !branch?.id) return;
    if (dayClosed) return setErrMsg("El día está cerrado.");
    if (needsBusinessSetup) return setErrMsg("Primero completá nombre del negocio.");

    const arsOpen = num(openingArsInput);
    const usdOpen = num(openingUsdInput);
    if (!Number.isFinite(arsOpen) || arsOpen < 0) return setErrMsg("ARS inicial inválido.");
    if (!Number.isFinite(usdOpen) || usdOpen < 0) return setErrMsg("USD inicial inválido.");

    setSavingOpening(true);
    setErrMsg(null);
    const { data, error } = await supabase
      .from("daily_openings")
      .upsert(
        {
          tenant_id: tenantId,
          branch_id: branch.id,
          business_date: businessDate,
          ars_open: arsOpen,
          usd_open: usdOpen,
        },
        { onConflict: "tenant_id,branch_id,business_date" }
      )
      .select("id,business_date,ars_open,usd_open,branch_id")
      .single<DailyOpeningRow>();
    setSavingOpening(false);
    if (error) {
      console.error(error);
      setErrMsg("No pude guardar caja inicial.");
      return;
    }
    setOpening(data);
    setOkMsg("Caja inicial guardada.");
  };

  return (
    <main className="cc-app min-h-screen flex items-start justify-center px-3 py-4 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-5 md:max-w-xl">
        <AppPageHeader title="Inicio del día" activeTab="operaciones" role={role} />

        <div className="mt-3 flex items-center justify-between gap-3 text-xs opacity-70">
          <span>Día operativo</span>
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
            className="rounded-lg border border-white/15 bg-transparent px-2 py-1 outline-none"
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
              {errMsg ? <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm">{errMsg}</div> : null}
              {okMsg ? <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">{okMsg}</div> : null}

              {needsBusinessSetup ? (
                <div className="mb-3 rounded-xl border border-white/10 p-4">
                  <div className="text-xs uppercase tracking-widest opacity-70">Configuración inicial</div>
                  {canManageTeam(role) ? (
                    <>
                      <div className="mt-1 text-xs opacity-70">Definí el nombre del negocio (solo una vez).</div>
                      <input
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        className="mt-3 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                        placeholder="Ej: Control Cambio Córdoba"
                      />
                      <button
                        onClick={saveBusinessName}
                        disabled={savingBusiness}
                        className="mt-3 w-full rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
                      >
                        {savingBusiness ? "Guardando..." : "Guardar nombre del negocio"}
                      </button>
                    </>
                  ) : (
                    <div className="mt-2 text-sm opacity-70">
                      Esperá a que el owner/admin configure el nombre del negocio.
                    </div>
                  )}
                </div>
              ) : null}

              {!opening ? (
                <div className="mb-3 rounded-xl border border-white/10 p-4">
                  <div className="text-xs uppercase tracking-widest opacity-70">Caja inicial del día</div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs opacity-70">ARS inicial</label>
                      <input
                        value={openingArsInput}
                        onChange={(e) => setOpeningArsInput(e.target.value)}
                        inputMode="decimal"
                        className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                        placeholder="Ej: 500000"
                      />
                    </div>
                    <div>
                      <label className="block text-xs opacity-70">USD inicial</label>
                      <input
                        value={openingUsdInput}
                        onChange={(e) => setOpeningUsdInput(e.target.value)}
                        inputMode="decimal"
                        className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                        placeholder="Ej: 10000"
                      />
                    </div>
                  </div>
                  <button
                    onClick={saveOpening}
                    disabled={savingOpening || needsBusinessSetup || dayClosed}
                    className="mt-3 w-full rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    {savingOpening ? "Guardando..." : "Guardar caja inicial"}
                  </button>
                </div>
              ) : (
                <div className="mb-3 rounded-xl border border-white/10 p-4 text-sm">
                  Caja inicial guardada: <b>{fmtARS(opening.ars_open)}</b> / <b>{fmtUSD(opening.usd_open)}</b>
                </div>
              )}

              <button
                onClick={() => router.push("/operaciones")}
                disabled={needsBusinessSetup || !opening}
                className="w-full rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
              >
                Ir a Operaciones
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
