"use client";

import { supabase } from "@/lib/supabase/client";

export type AppRole = "owner" | "admin" | "supervisor" | "operator";

type ProfileWithRoleRow = {
  id: string;
  email: string | null;
  tenant_id: string | null;
  role: string | null;
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
    return {
      id: withRole.data.id,
      email: withRole.data.email,
      tenant_id: withRole.data.tenant_id,
      role: normalizeRole(withRole.data.role),
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
