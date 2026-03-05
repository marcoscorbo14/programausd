"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function Home() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setLoading(false);
    });
  }, []);

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: "http://localhost:3000" },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setEmail(null);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
        <div className="text-xs uppercase tracking-widest opacity-70">Control Cambio</div>
        <h1 className="mt-2 text-2xl font-semibold">Login (MVP)</h1>
        <p className="mt-2 text-sm opacity-70">Entrá con Google para empezar.</p>

        <div className="mt-6">
          {loading ? (
            <div className="text-sm opacity-70">Cargando...</div>
          ) : email ? (
            <>
              <div className="text-sm opacity-70">Conectado como</div>
              <div className="mt-1 font-medium">{email}</div>

              <button
                onClick={signOut}
                className="mt-4 w-full rounded-xl border border-white/15 px-4 py-2 hover:bg-white/10"
              >
                Cerrar sesión
              </button>
            </>
          ) : (
            <button
              onClick={signIn}
              className="w-full rounded-xl border border-white/15 px-4 py-2 hover:bg-white/10"
            >
              Entrar con Google
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
