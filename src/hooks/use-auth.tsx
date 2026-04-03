import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthContextValue = {
  session: Session | null;
  isAdmin: boolean;
  isLoading: boolean;
  userEmail: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  resendSignupConfirmation: (email: string) => Promise<string | null>;
  signOut: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function loadAdminStatus(session: Session | null) {
  if (!session) return false;

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", session.user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Failed to load admin role", error);
  }

  return Boolean(data);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const currentUserIdRef = useRef<string | null>(null);
  const syncRequestRef = useRef(0);

  useEffect(() => {
    let isActive = true;

    const syncSession = async (
      nextSession: Session | null,
      options?: { event?: AuthChangeEvent; forceLoading?: boolean },
    ) => {
      if (!isActive) return;

      const nextUserId = nextSession?.user.id ?? null;
      const currentUserId = currentUserIdRef.current;
      const shouldShowLoading =
        options?.forceLoading ??
        currentUserId !== nextUserId;

      if (shouldShowLoading) {
        setIsLoading(true);
      }

      setSession(nextSession);
      currentUserIdRef.current = nextUserId;

      const requestId = ++syncRequestRef.current;

      if (!nextSession) {
        setIsAdmin(false);
        setIsLoading(false);
        return;
      }

      const nextIsAdmin = await loadAdminStatus(nextSession);

      if (!isActive || requestId !== syncRequestRef.current) return;

      setIsAdmin(nextIsAdmin);
      setIsLoading(false);
    };

    void supabase.auth.getSession().then(({ data }) => {
      void syncSession(data.session, { forceLoading: true });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "TOKEN_REFRESHED" && currentUserIdRef.current === (nextSession?.user.id ?? null)) {
        setSession(nextSession);
        return;
      }

      void syncSession(nextSession, { event });
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error?.message ?? null;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return error?.message ?? null;
  };

  const resendSignupConfirmation = async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
    });

    return error?.message ?? null;
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        isAdmin,
        isLoading,
        userEmail: session?.user.email ?? null,
        signIn,
        resendSignupConfirmation,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
