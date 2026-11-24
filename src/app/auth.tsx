import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Navigate, useLocation } from 'react-router';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  /** Arrived through a password reset link: a new password must be chosen. */
  recovery: boolean;
  endRecovery(): void;
}

// Read before Supabase clears the link's fragment from the address bar.
const recoveryLink = typeof window !== 'undefined' && /(^|[#&])type=recovery(&|$)/.test(window.location.hash);

const AuthContext = createContext<AuthState>({ session: null, loading: true, recovery: false, endRecovery: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ session: Session | null; loading: boolean }>({ session: null, loading: true });
  const [recovery, setRecovery] = useState(recoveryLink);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ session: data.session, loading: false });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setState({ session, loading: false });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, recovery, endRecovery: () => setRecovery(false) }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="splash" role="status">
        Chargement…
      </div>
    );
  }
  if (!session) {
    const back = location.pathname + location.search;
    return <Navigate to={`/connexion?retour=${encodeURIComponent(back)}`} replace />;
  }
  return <>{children}</>;
}
