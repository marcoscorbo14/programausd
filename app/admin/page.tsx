"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AppPageHeader } from "@/app/components/app-page-header";
import { canManageTeam, getProfileWithRole, normalizeRole, type AppRole } from "@/lib/security";

type BranchRow = { id: string; name: string };
type MemberWithRoleRow = { id: string; email: string | null; role: string | null };
type MemberBaseRow = { id: string; email: string | null };
type TeamMembershipRow = {
  id: string;
  tenant_id: string;
  email: string;
  role: string | null;
  is_active: boolean | null;
};

type Member = {
  id: string;
  email: string | null;
  role: AppRole;
};

const ROLE_OPTIONS: AppRole[] = ["owner", "admin", "supervisor", "operator"];

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [role, setRole] = useState<AppRole>("operator");
  const [members, setMembers] = useState<Member[]>([]);
  const [savingBusinessName, setSavingBusinessName] = useState(false);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [pendingMembers, setPendingMembers] = useState<TeamMembershipRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("operator");
  const [savingInvite, setSavingInvite] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [roleColumnAvailable, setRoleColumnAvailable] = useState(true);

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
    setRoleColumnAvailable(profile.roleColumnAvailable);
    if (profile.error || !profile.tenant_id) {
      setErrMsg("No pude leer tu perfil.");
      setLoading(false);
      return;
    }
    setTenantId(profile.tenant_id);

    const { data: branchRows, error: branchErr } = await supabase
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
    const b = branchRows?.[0] ?? null;
    setBranch(b);
    setBusinessName(b?.name ?? "");

    if (canManageTeam(profile.role)) {
      const withRole = await supabase
        .from("profiles")
        .select("id,email,role")
        .eq("tenant_id", profile.tenant_id)
        .order("created_at", { ascending: true });

      if (!withRole.error) {
        const rows = (withRole.data ?? []) as MemberWithRoleRow[];
        setMembers(rows.map((m) => ({ id: m.id, email: m.email, role: normalizeRole(m.role) })));
      } else {
        const fallback = await supabase
          .from("profiles")
          .select("id,email")
          .eq("tenant_id", profile.tenant_id)
          .order("created_at", { ascending: true });
        if (fallback.error) {
          console.error(fallback.error);
          setErrMsg("No pude leer miembros del equipo.");
        } else {
          const rows = (fallback.data ?? []) as MemberBaseRow[];
          setMembers(rows.map((m) => ({ id: m.id, email: m.email, role: "operator" })));
        }
      }

      const pending = await supabase
        .from("team_memberships")
        .select("id,tenant_id,email,role,is_active")
        .eq("tenant_id", profile.tenant_id)
        .order("created_at", { ascending: false });
      if (!pending.error) {
        setPendingMembers((pending.data ?? []) as TeamMembershipRow[]);
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      void loadAll();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const signIn = async () => {
    const redirectTo = `${window.location.origin}/admin`;
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setEmail(null);
    setTenantId(null);
    setMembers([]);
  };

  const saveBusiness = async () => {
    if (!tenantId || !branch?.id) return;
    if (!canManageTeam(role)) {
      setErrMsg("Solo owner/admin puede modificar el nombre del negocio.");
      return;
    }
    const trimmed = businessName.trim();
    if (!trimmed) {
      setErrMsg("Ingresá un nombre válido.");
      return;
    }
    setSavingBusinessName(true);
    setErrMsg(null);
    const { error } = await supabase
      .from("branches")
      .update({ name: trimmed })
      .eq("tenant_id", tenantId)
      .eq("id", branch.id);
    setSavingBusinessName(false);
    if (error) {
      console.error(error);
      setErrMsg("No pude guardar el nombre del negocio.");
      return;
    }
    setBranch({ ...branch, name: trimmed });
    setOkMsg("Nombre del negocio actualizado.");
  };

  const saveMemberRole = async (memberId: string, nextRole: AppRole) => {
    if (!tenantId || !canManageTeam(role)) return;
    setSavingMemberId(memberId);
    setErrMsg(null);
    const { error } = await supabase
      .from("profiles")
      .update({ role: nextRole })
      .eq("tenant_id", tenantId)
      .eq("id", memberId);
    setSavingMemberId(null);
    if (error) {
      console.error(error);
      setErrMsg("No pude actualizar el rol. Revisá que exista la columna profiles.role.");
      return;
    }
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: nextRole } : m)));
    setOkMsg("Rol actualizado.");
  };

  const addPendingMember = async () => {
    if (!tenantId || !canManageTeam(role)) return;
    const emailNorm = inviteEmail.trim().toLowerCase();
    if (!emailNorm.includes("@")) {
      setErrMsg("Ingresá un email válido.");
      return;
    }
    setSavingInvite(true);
    setErrMsg(null);
    const { error } = await supabase
      .from("team_memberships")
      .upsert(
        { tenant_id: tenantId, email: emailNorm, role: inviteRole, is_active: true },
        { onConflict: "tenant_id,email" }
      );
    setSavingInvite(false);
    if (error) {
      console.error(error);
      setErrMsg("No pude guardar operador por email. Ejecutá la migración de team_memberships.");
      return;
    }
    setInviteEmail("");
    setInviteRole("operator");
    setOkMsg("Operador precargado. Cuando inicie sesión quedará vinculado.");
    const pending = await supabase
      .from("team_memberships")
      .select("id,tenant_id,email,role,is_active")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (!pending.error) setPendingMembers((pending.data ?? []) as TeamMembershipRow[]);
  };

  return (
    <main className="cc-app min-h-screen flex items-start justify-center px-3 py-4 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm sm:p-5 md:max-w-2xl">
        <AppPageHeader title="Configuración" activeTab="admin" role={role} />

        <div className="mt-4">
          {loading ? (
            <div className="text-sm opacity-70">Cargando...</div>
          ) : !email ? (
            <button onClick={signIn} className="w-full rounded-xl border border-white/15 px-4 py-2 hover:bg-white/10">
              Entrar con Google
            </button>
          ) : (
            <>
              {!roleColumnAvailable ? (
                <div className="mb-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs">
                  Falta configurar <b>profiles.role</b>. Podés gestionar negocio, pero roles requieren migración SQL.
                </div>
              ) : null}

              {errMsg ? (
                <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm">{errMsg}</div>
              ) : null}
              {okMsg ? (
                <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">{okMsg}</div>
              ) : null}

              <div className="rounded-xl border border-white/10 p-4">
                <div className="text-xs uppercase tracking-widest opacity-70">Negocio</div>
                <label className="mt-3 block text-xs opacity-70">Nombre del negocio</label>
                <input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  disabled={!canManageTeam(role)}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                  placeholder="Ej: Control Cambio Córdoba"
                />
                <button
                  onClick={saveBusiness}
                  disabled={savingBusinessName || !canManageTeam(role)}
                  className="mt-3 w-full rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  {savingBusinessName ? "Guardando..." : "Guardar nombre"}
                </button>
                {!canManageTeam(role) ? (
                  <div className="mt-2 text-xs opacity-70">Solo owner/admin puede editar este dato.</div>
                ) : null}
              </div>

              <div className="mt-4 rounded-xl border border-white/10 p-4">
                <div className="text-xs uppercase tracking-widest opacity-70">Equipo y permisos</div>
                {!canManageTeam(role) ? (
                  <div className="mt-3 text-sm opacity-70">
                    Tu rol actual es <b>{role}</b>. Solo owner/admin pueden editar roles.
                  </div>
                ) : members.length === 0 ? (
                  <div className="mt-3 text-sm opacity-70">No hay usuarios para este tenant.</div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {members.map((m) => (
                      <div key={m.id} className="rounded-xl border border-white/10 p-3">
                        <div className="text-sm">{m.email ?? m.id}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <select
                            value={m.role}
                            onChange={(e) => saveMemberRole(m.id, e.target.value as AppRole)}
                            disabled={savingMemberId === m.id}
                            className="w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                          >
                            {ROLE_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {canManageTeam(role) ? (
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <div className="text-xs uppercase tracking-widest opacity-70">Alta previa por email</div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px]">
                      <input
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                        placeholder="pedrito@gmail.com"
                      />
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as AppRole)}
                        className="w-full rounded-xl border border-white/15 bg-transparent px-3 py-2 outline-none"
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={addPendingMember}
                      disabled={savingInvite}
                      className="mt-2 w-full rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 font-medium text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
                    >
                      {savingInvite ? "Guardando..." : "Guardar operador por email"}
                    </button>

                    {pendingMembers.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {pendingMembers.map((p) => (
                          <div key={p.id} className="rounded-xl border border-white/10 p-2 text-xs">
                            {p.email} • rol: <b>{p.role ?? "operator"}</b>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
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
