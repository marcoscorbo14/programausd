"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AppPageHeader } from "@/app/components/app-page-header";

type ProfileRow = { id: string; email: string | null; tenant_id: string | null };

type ClientRow = {
  id: string;
  tenant_id: string;
  name: string;
  full_name: string;
  phone: string | null;
  referred_by_text: string;
  created_at: string;
};

function norm(s: string) {
  return (s ?? "").toString().trim();
}
function contains(hay: string, needle: string) {
  return hay.toLowerCase().includes(needle.toLowerCase());
}
function getQS() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export default function ClientsPage() {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const refRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");

  // Prefill / return
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  // List & search
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = norm(q);
    if (!query) return clients;

    return clients.filter((c) => {
      return (
        contains(c.name ?? "", query) ||
        contains(c.full_name ?? "", query) ||
        contains(c.phone ?? "", query) ||
        contains(c.referred_by_text ?? "", query)
      );
    });
  }, [clients, q]);

  async function loadBase() {
    setLoading(true);
    setErrMsg(null);
    setOkMsg(null);

    // ✅ Leer query params (prefill + return)
    const qs = getQS();
    const qName = norm(qs.get("prefill_name") || "");
    const qPhone = norm(qs.get("prefill_phone") || "");
    const qReturn = norm(qs.get("return_to") || "");

    setReturnTo(qReturn || null);

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;

    if (!user) {
      setTenantId(null);
      setClients([]);
      setLoading(false);
      return;
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id,email,tenant_id")
      .eq("id", user.id)
      .single<ProfileRow>();

    if (profileErr || !profile?.tenant_id) {
      console.error(profileErr);
      setErrMsg("No pude leer tu perfil (profiles).");
      setTenantId(null);
      setClients([]);
      setLoading(false);
      return;
    }

    setTenantId(profile.tenant_id);

    // 1) Asegurar "Cliente casual"
    await ensureCasualClient(profile.tenant_id);

    // 2) Cargar últimos clientes
    await loadClients(profile.tenant_id);

    setLoading(false);

    // ✅ Prefill del formulario si vino desde Operaciones
    if (!prefilled && qName) {
      setPrefilled(true);
      setName(qName);
      setPhone(qPhone);
      // foco a referencia para terminar rápido
      setTimeout(() => refRef.current?.focus(), 50);
    } else {
      // UX normal: foco al nombre
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }

  async function ensureCasualClient(tid: string) {
    const { data: existing, error: selErr } = await supabase
      .from("clients")
      .select("id,name,tenant_id,full_name,phone,referred_by_text,created_at")
      .eq("tenant_id", tid)
      .ilike("name", "cliente casual")
      .limit(1);

    if (selErr) {
      console.error(selErr);
      return;
    }

    if (existing && existing.length > 0) return;

    // referencia obligatoria
    const payload = {
      tenant_id: tid,
      name: "Cliente casual",
      full_name: "Cliente casual",
      referred_by_text: "Sistema (auto)",
      phone: null as string | null,
    };

    const { error: insErr } = await supabase.from("clients").insert(payload);
    if (insErr) console.error(insErr);
  }

  async function loadClients(tid: string) {
    const { data, error } = await supabase
      .from("clients")
      .select("id,tenant_id,name,full_name,phone,referred_by_text,created_at")
      .eq("tenant_id", tid)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) {
      console.error(error);
      setErrMsg("No pude leer clientes (clients).");
      setClients([]);
      return;
    }

    const rows = (data ?? []) as ClientRow[];

    // Pinned: Cliente casual arriba
    rows.sort((a, b) => {
      const aCasual = (a.name || "").toLowerCase() === "cliente casual" ? 0 : 1;
      const bCasual = (b.name || "").toLowerCase() === "cliente casual" ? 0 : 1;
      if (aCasual !== bCasual) return aCasual - bCasual;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    setClients(rows);
  }

  async function createClient() {
    setErrMsg(null);
    setOkMsg(null);

    const tid = tenantId;
    if (!tid) return;

    const n = norm(name);
    const r = norm(reference);
    const p = norm(phone);

    if (!n) {
      setErrMsg("El nombre es obligatorio.");
      nameRef.current?.focus();
      return;
    }
    if (!r) {
      setErrMsg("La referencia es obligatoria.");
      refRef.current?.focus();
      return;
    }

    // evitar duplicar "Cliente casual"
    if (n.toLowerCase() === "cliente casual") {
      setErrMsg("Ese nombre está reservado. Usá otro nombre.");
      nameRef.current?.focus();
      return;
    }

    const payload = {
      tenant_id: tid,
      name: n,
      full_name: n,
      phone: p ? p : null,
      referred_by_text: r,
    };

    const { error } = await supabase.from("clients").insert(payload);

    if (error) {
      console.error(error);
      setErrMsg("No pude guardar el cliente.");
      return;
    }

    setOkMsg("Cliente guardado.");

    // refresco lista
    await loadClients(tid);

    // reset form
    setName("");
    setPhone("");
    setReference("");

    // ✅ si venimos desde operaciones, volvemos
    if (returnTo) {
      // un pequeño delay para que se vea el OK
      setTimeout(() => {
        window.location.href = returnTo;
      }, 350);
      return;
    }

    // foco para cargar rápido el próximo
    nameRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void createClient();
    }
  }

  useEffect(() => {
    void loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="cc-app min-h-screen flex items-start justify-center px-3 py-4 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-5 md:max-w-2xl lg:max-w-3xl">
        <AppPageHeader title="Clientes" activeTab="clients" />

        {errMsg ? (
          <div role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
            {errMsg}
          </div>
        ) : null}

        {okMsg ? (
          <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            ✅ {okMsg}
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-white/10 p-4">
            <div className="text-xs uppercase tracking-widest opacity-70">Nuevo cliente</div>

            <label className="mt-3 block text-xs opacity-70">Nombre *</label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onKeyDown}
              required
              aria-required="true"
              className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
              placeholder="Ej: Juan Pérez"
            />

            <label className="mt-3 block text-xs opacity-70">Teléfono (opcional)</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={onKeyDown}
              className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
              placeholder="Ej: 351..."
            />

            <label className="mt-3 block text-xs opacity-70">Referencia *</label>
            <input
              ref={refRef}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={onKeyDown}
              required
              aria-required="true"
              className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
              placeholder="Ej: recomendado por..."
            />

            <button
              type="button"
              onClick={() => void createClient()}
              disabled={loading || !tenantId}
              className="mt-4 w-full rounded-xl border border-white/15 px-4 py-2 hover:bg-white/10 disabled:opacity-50"
            >
              Guardar cliente
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 p-4">
            <div className="text-xs uppercase tracking-widest opacity-70">Buscar</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
              placeholder="Nombre / teléfono / referencia"
            />
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 p-4">
          <div className="text-xs uppercase tracking-widest opacity-70">Últimos clientes</div>

          {loading ? (
            <div className="mt-3 text-sm opacity-70">Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="mt-3 text-sm opacity-70">No hay clientes todavía.</div>
          ) : (
            <div className="mt-3 divide-y divide-white/10 rounded-xl border border-white/10">
              {filtered.slice(0, 30).map((c) => (
                <div key={c.id} className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">
                      {c.name}
                      {(c.name || "").toLowerCase() === "cliente casual" ? (
                        <span className="ml-2 rounded-full border border-white/15 px-2 py-0.5 text-xs opacity-80">
                          casual
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs opacity-60">{new Date(c.created_at).toLocaleString()}</div>
                  </div>

                  <div className="mt-1 text-xs opacity-70">
                    {c.phone ? <>{c.phone} • </> : null}
                    Ref: {c.referred_by_text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 text-sm underline opacity-80 hover:opacity-100">
          <Link href={returnTo || "/operaciones"}>← {returnTo ? "Volver" : "Operaciones"}</Link>
        </div>
      </div>
    </main>
  );
}
