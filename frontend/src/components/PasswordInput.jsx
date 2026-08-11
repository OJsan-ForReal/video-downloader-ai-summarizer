import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function PasswordInput({ label, value, onChange, helperText, ...inputProps }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-10 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500"
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
        >
          {visible ? (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.6 10.6a3 3 0 0 0 4.24 4.24M6.6 6.6C4.2 8.1 2 12 2 12s3.5 7 10 7c1.8 0 3.3-.5 4.6-1.2M17.9 17.9C20.1 16.3 22 12 22 12s-1.2-2.4-3.3-4.3" />
            </svg>
          )}
        </button>
      </div>
      {helperText && <p className="mt-1 text-xs text-slate-400">{helperText}</p>}
    </div>
  )
}
