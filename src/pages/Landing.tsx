import { Link } from 'react-router-dom'

export function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-4">
          <span className="text-white">Striker</span>
          <span className="text-accent">Clips</span>
        </h1>
        <p className="text-xl text-gray-400 mb-8">
          Combine 4–8 clips into highlight reels. Share matches. Connect with the community.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            to="/signup"
            className="px-8 py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow transition-all hover:scale-105"
          >
            Get Started
          </Link>
          <Link
            to="/reels"
            className="px-8 py-3 rounded-lg border border-dark-border text-gray-300 hover:border-accent/50 hover:text-accent transition-colors"
          >
            Browse Reels
          </Link>
        </div>
        <div className="mt-16 grid grid-cols-3 gap-8 text-center">
          <div className="p-4 rounded-xl bg-dark-card/50 border border-dark-border hover:border-accent/30 transition-colors">
            <div className="text-3xl font-mono text-accent mb-2">4–8</div>
            <div className="text-sm text-gray-400">Clips per reel</div>
          </div>
          <div className="p-4 rounded-xl bg-dark-card/50 border border-dark-border hover:border-accent/30 transition-colors">
            <div className="text-3xl font-mono text-accent mb-2">100%</div>
            <div className="text-sm text-gray-400">Free tier</div>
          </div>
          <div className="p-4 rounded-xl bg-dark-card/50 border border-dark-border hover:border-accent/30 transition-colors">
            <div className="text-3xl font-mono text-accent mb-2">∞</div>
            <div className="text-sm text-gray-400">Creativity</div>
          </div>
        </div>
      </div>
    </div>
  )
}
