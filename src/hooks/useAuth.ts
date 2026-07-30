// `useAuth` now consumes the shared AuthContext (single session + profile +
// loading, one onAuthStateChange subscription) instead of running its own
// per-component session lookup. Re-exported here so every existing
// `@/hooks/useAuth` import keeps working unchanged.
export { useAuth, type AuthState } from './AuthContext'
