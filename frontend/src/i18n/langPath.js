import { useParams } from 'react-router-dom'

// URL 是语言状态的唯一真实来源：这里不读 localStorage，只从路由 :lang 段派生
export const SUPPORTED_LANGS = ['en', 'pt']
export const ALL_LANGS = ['zh', 'en', 'pt']

export function prefixForLang(lang) {
  return !lang || lang === 'zh' ? '' : `/${lang}`
}

export function withLang(lang, path) {
  const prefix = prefixForLang(lang)
  if (path === '/') return prefix || '/'
  return `${prefix}${path}`
}

export function stripLangPrefix(pathname, currentLang) {
  const prefix = prefixForLang(currentLang)
  if (!prefix) return pathname
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) || '/' : pathname
}

// null = URL 里带了一个不认识的语言前缀（比如 /fr/xxx），交给现有的“找不到页面”逻辑处理
export function useCurrentLang() {
  const { lang: rawLang } = useParams()
  if (!rawLang) return 'zh'
  return SUPPORTED_LANGS.includes(rawLang) ? rawLang : null
}

export function useLangPath() {
  const lang = useCurrentLang() || 'zh'
  return (path) => withLang(lang, path)
}
