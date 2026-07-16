import logoUrl from '@/assets/maktab_logo_transparent.png'

export function DocumentLetterhead({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-4 flex flex-col items-center text-center">
      <img src={logoUrl} alt="Maktab Educational Institute crest" className="mb-2 h-16 w-auto" />
      <p className="text-lg font-semibold">Maktab Educational Institute</p>
      <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
    </div>
  )
}
