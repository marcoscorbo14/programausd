"use client";

import { supabase } from "@/lib/supabase/client";

export type AppRole = "owner" | "admin" | "supervisor" | "operator";

type ProfileWithRoleRow = {
  id: string;
  email: string | null;
  tenant_id: string | null;
  role: string | null;
};

type TeamMembershipRow = {
  tenant_id: string;
  email: string;
  role: string | null;
  is_active: boolean | null;
};

type ProfileBaseRow = {
  id: string;
  email: string | null;
  tenant_id: string | null;
};

export function normalizeRole(role: string | null | undefined): AppRole {
  const value = String(role ?? "").toLowerCase();
  if (value === "owner" || value === "admin" || value === "supervisor" || value === "operator") {
    return value;
  }
  return "operator";
}

export function canManageTeam(role: AppRole) {
  return role === "owner" || role === "admin";
}

export function canCorrectDay(role: AppRole) {
  return role === "owner" || role === "admin" || role === "supervisor";
}

export function canViewReports(role: AppRole) {
  return role === "owner" || role === "admin" || role === "supervisor";
}

export async function getProfileWithRole(userId: string): Promise<{
  id: string;
  email: string | null;
  tenant_id: string | null;
  role: AppRole;
  roleColumnAvailable: boolean;
  error: string | null;
}> {
  const withRole = await supabase
    .from("profiles")
    .select("id,email,tenant_id,role")
    .eq("id", userId)
    .single<ProfileWithRoleRow>();

  if (!withRole.error && withRole.data) {
    // Alta previa por email: si el perfil existe pero todavía no tiene tenant,
    // intentamos vincularlo automáticamente desde team_memberships.
    if (!withRole.data.tenant_id && withRole.data.email) {
      const membership = await supabase
        .from("team_memberships")
        .select("tenant_id,email,role,is_active")
        .eq("email", withRole.data.email.toLowerCase())
        .eq("is_active", true)
        .maybeSingle<TeamMembershipRow>();

      if (!membership.error && membership.data?.tenant_id) {
        const claimRole = normalizeRole(membership.data.role);
        const claim = await supabase
          .from("profiles")
          .update({ tenant_id: membership.data.tenant_id, role: claimRole })
          .eq("id", userId);
        if (!claim.error) {
          withRole.data.tenant_id = membership.data.tenant_id;
          withRole.data.role = claimRole;
        }
      }
    }

    let normalized = normalizeRole(withRole.data.role);

    // Reparación automática: si quedó como operator pero es el único usuario del tenant,
    // lo promovemos a owner para evitar bloqueo de administración inicial.
    if (normalized === "operator" && withRole.data.tenant_id) {
      const onlyUserCheck = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", withRole.data.tenant_id);
      const count = onlyUserCheck.count ?? 0;
      if (!onlyUserCheck.error && count <= 1) {
        const promote = await supabase
          .from("profiles")
          .update({ role: "owner" })
          .eq("id", userId)
          .eq("tenant_id", withRole.data.tenant_id);
        if (!promote.error) normalized = "owner";
      }
    }

    return {
      id: withRole.data.id,
      email: withRole.data.email,
      tenant_id: withRole.data.tenant_id,
      role: normalized,
      roleColumnAvailable: true,
      error: null,
    };
  }

  const fallback = await supabase
    .from("profiles")
    .select("id,email,tenant_id")
    .eq("id", userId)
    .single<ProfileBaseRow>();

  if (fallback.error || !fallback.data) {
    return {
      id: userId,
      email: null,
      tenant_id: null,
      role: "operator",
      roleColumnAvailable: false,
      error: "No pude leer profiles.",
    };
  }

  return {
    id: fallback.data.id,
    email: fallback.data.email,
    tenant_id: fallback.data.tenant_id,
    role: "owner",
    roleColumnAvailable: false,
    error: null,
  };
}
