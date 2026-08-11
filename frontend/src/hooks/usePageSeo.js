import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/** 每个页面组件挂载时调用一次，把 <title> 和 meta description 换成这个页面自己的文案
 * （而不是全站共用一个标题），随语言切换也会跟着重新翻译 */
export default function usePageSeo(seoKey) {
  const { t, i18n } = useTranslation()

  useEffect(() => {
    document.title = t(`seo.${seoKey}.title`)

    let meta = document.querySelector('meta[name="description"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'description')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', t(`seo.${seoKey}.description`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seoKey, t, i18n.language])
}
