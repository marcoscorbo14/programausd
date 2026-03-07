import Link from "next/link";

type TabKey = "operaciones" | "clients" | "cierre" | "reporte";

type AppPageHeaderProps = {
  title: string;
  activeTab: TabKey;
};

const tabs: Array<{ key: TabKey; href: string; label: string }> = [
  { key: "operaciones", href: "/operaciones", label: "Operaciones" },
  { key: "clients", href: "/clients", label: "Clientes" },
  { key: "cierre", href: "/cierre", label: "Cierre" },
  { key: "reporte", href: "/reporte", label: "Reporte" },
];

export function AppPageHeader({ title, activeTab }: AppPageHeaderProps) {
  return (
    <>
      <div className="text-xs uppercase tracking-widest text-white/65">Control Cambio</div>
      <h1 className="mt-1 text-2xl font-semibold sm:text-[2rem]">{title}</h1>

      <nav aria-label="Secciones" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2 py-2 text-center text-xs text-emerald-100"
                  : "rounded-lg border border-white/15 px-2 py-2 text-center text-xs hover:bg-white/10"
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
