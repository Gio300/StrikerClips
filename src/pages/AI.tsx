import { Link } from 'react-router-dom'
import { AISettings } from '@/components/AISettings'

export function AI() {
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-2">AI tools</h1>
        <p className="text-gray-400">
          Lightweight features in the web app: audio-based clutch detection and client-side cuts — no server bill.
          The desktop install adds an on-device LLM (Ollama + Llama 3.2 1B) and a local TTS (Piper) for
          fully-offline commentary. Bring-your-own-key options below give the web app premium voices and bigger
          models when you want them, at your own cost.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FeatureCard
          name="Auto-Highlight Detector"
          status="Live"
          statusColor="text-green-400"
          description="Pick out the explosive action moments from any uploaded clip by analyzing audio energy spikes — KOs, ougis, jutsu impacts. Use it from the Create Highlight page on any uploaded clip."
          cta={<Link to="/highlight/create" className="text-accent hover:underline">Try it →</Link>}
        />
        <FeatureCard
          name="Multi-Angle Stitcher"
          status="Live"
          statusColor="text-green-400"
          description="Combine teammates' clips into a 2x2 squad view, side-by-side comparison, or picture-in-picture. All stitched in your browser via ffmpeg.wasm."
          cta={<Link to="/highlight/create" className="text-accent hover:underline">Try it →</Link>}
        />
        <FeatureCard
          name="Clip Trimmer"
          status="Live"
          statusColor="text-green-400"
          description="Frame-accurate trimming of uploaded clips before stitching. Built into the highlight creator."
        />
        <FeatureCard
          name="Vision Model Tagging"
          status="Planned"
          statusColor="text-gray-500"
          description="Optionally send 1-frame-per-second thumbnails to a cheap vision model (Gemini Flash, ~$0.01 per 2-min clip) to label specific moves and enemies. Off by default."
        />
        <FeatureCard
          name="Auto-thumbnail picker"
          status="Planned"
          statusColor="text-gray-500"
          description="Pick the best frame from a clip using a heuristic (motion + brightness) for the reel thumbnail."
        />
        <FeatureCard
          name="Tournament rules bot"
          status="Planned"
          statusColor="text-gray-500"
          description="Discord-style command bot in Boards — answers rule questions, looks up match types, posts brackets."
        />
      </div>

      <AISettings />
    </div>
  )
}

function FeatureCard({
  name,
  status,
  statusColor,
  description,
  cta,
}: {
  name: string
  status: string
  statusColor: string
  description: string
  cta?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-5">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h2 className="font-semibold">{name}</h2>
        <span className={`text-xs ${statusColor}`}>{status}</span>
      </div>
      <p className="text-sm text-gray-400 mb-3">{description}</p>
      {cta}
    </div>
  )
}
