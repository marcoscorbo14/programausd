import Link from "next/link";
import type { AppRole } from "@/lib/security";

type TabKey = "operaciones" | "clients" | "cierre" | "reporte" | "admin";

type AppPageHeaderProps = {
  title: string;
  activeTab: TabKey;
  role?: AppRole | null;
};

const tabs: Array<{ key: TabKey; href: string; label: string }> = [
  { key: "operaciones", href: "/operaciones", label: "Operaciones" },
  { key: "clients", href: "/clients", label: "Clientes" },
  { key: "cierre", href: "/cierre", label: "Cierre" },
  { key: "reporte", href: "/reporte", label: "Reporte" },
  { key: "admin", href: "/admin", label: "Configuración" },
];

export function AppPageHeader({ title, activeTab, role }: AppPageHeaderProps) {
  const visibleTabs = tabs.filter((tab) => {
    if (tab.key === "reporte" && role === "operator") return false;
    if (tab.key === "admin" && role === "operator") return false;
    return true;
  });

  return (
    <>
      <div className="text-xs uppercase tracking-widest text-white/65">Control Cambio</div>
      <h1 className="mt-1 text-2xl font-semibold sm:text-[2rem]">{title}</h1>

      <nav
        aria-label="Secciones"
        className={`mt-3 grid grid-cols-2 gap-2 ${visibleTabs.length >= 5 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}
      >
        {visibleTabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2 py-2 text-center text-xs text-emerald-100 focus-visible:outline-none"
                  : "rounded-lg border border-white/15 px-2 py-2 text-center text-xs hover:bg-white/10 focus-visible:outline-none"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
