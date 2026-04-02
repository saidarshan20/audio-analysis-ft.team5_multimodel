import { createContext, useContext } from 'react';

const AUTH_KEY = 'iagentops_auth';

export interface AuthUser {
  username: string;
}

// Persist auth to sessionStorage so a full-page reload restores it
export function getStoredAuth(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(user: AuthUser): void {
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

export function clearStoredAuth(): void {
  sessionStorage.removeItem(AUTH_KEY);
}

// Context — consumers get the current user or null
export interface AuthContextValue {
  user: AuthUser | null;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  logout: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
