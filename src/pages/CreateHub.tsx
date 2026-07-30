import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { CreateIntentPicker } from '@/components/CreateIntentPicker'

export function CreateHub() {
  const navigate = useNavigate()

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <div className="mb-6 flex items-start gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dark-border text-gray-400 transition-colors hover:bg-dark-elevated hover:text-white"
          aria-label="Go back"
          title="Go back"
        >
          <ArrowLeft size={19} />
        </button>
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-kunai">
            <Sparkles size={15} aria-hidden />
            Create
          </div>
          <h1 className="text-2xl font-bold text-white md:text-3xl">What do you want to make?</h1>
          <p className="mt-1 text-sm text-gray-400">
            Pick one goal. TKO will take you through the setup.
          </p>
        </div>
      </div>

      <CreateIntentPicker />
    </main>
  )
}
