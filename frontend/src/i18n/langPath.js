import { useParams } from 'react-router-dom'

// URL 是语言状态的唯一真实来源：这里不读 localStorage，只从路由 :lang 段派生。
// 默认语言（无前缀）是英文——面向的主要是海外流量。中文走 /cn 前缀（不是 /zh：URL 段跟
// i18next 内部语言码是两件事，/cn 只是给访客看的路径，内部翻译资源用的 key 还是 zh）。
// /en 这个前缀继续保留兼容——效果跟不带前缀完全一样，不会让别处已经存在的 /en 链接失效。
const URL_TO_CODE = { cn: 'zh', en: 'en', pt: 'pt' }
const CODE_TO_URL = { zh: 'cn', en: 'en', pt: 'pt' }
const KNOWN_URL_SEGMENTS = Object.keys(URL_TO_CODE)

export const DEFAULT_LANG = 'en'
export const ALL_LANGS = ['en', 'zh', 'pt']

export function prefixForLang(lang) {
  return !lang || lang === DEFAULT_LANG ? '' : `/${CODE_TO_URL[lang] || lang}`
}

export function withLang(lang, path) {
  const prefix = prefixForLang(lang)
  if (path === '/') return prefix || '/'
  return `${prefix}${path}`
}

// 纯粹根据 URL 本身有没有已知语言段来剥前缀，不依赖"当前语言是什么"——不然从显式的 /en
// 切换语言时，因为 en 是默认语言、prefixForLang('en') 是空字符串，会剥不掉这段 /en
export function stripLangPrefix(pathname) {
  const match = pathname.match(/^\/([a-z]{2})(\/.*)?$/)
  if (match && KNOWN_URL_SEGMENTS.includes(match[1])) {
    return match[2] || '/'
  }
  return pathname
}

// null = URL 里带了一个不认识的语言前缀（比如 /fr/xxx），交给现有的“找不到页面”逻辑处理
export function useCurrentLang() {
  const { lang: rawLang } = useParams()
  if (!rawLang) return DEFAULT_LANG
  return URL_TO_CODE[rawLang] || null
}

export function useLangPath() {
  const lang = useCurrentLang() || DEFAULT_LANG
  return (path) => withLang(lang, path)
}
