import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import * as authApi from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [oauthError, setOauthError] = useState(null)

  useEffect(() => {
    const oauthResult = authApi.consumeOAuthRedirect()
    if (oauthResult && !oauthResult.ok) setOauthError(oauthResult.message)
    authApi.getCurrentUser().then(setUser).finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email, password) => {
    await authApi.login(email, password)
    const u = await authApi.getCurrentUser()
    setUser(u)
    return u
  }, [])

  const register = useCallback(async (email, password) => {
    await authApi.register(email, password)
    return login(email, password)
  }, [login])

  const logout = useCallback(() => {
    authApi.logout()
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const u = await authApi.getCurrentUser()
    setUser(u)
    return u
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser, oauthError }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内部使用')
  return ctx
}
