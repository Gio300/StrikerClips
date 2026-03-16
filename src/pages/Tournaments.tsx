import { Link } from 'react-router-dom'

export function Tournaments() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Active Tournaments</h1>
      <p className="text-gray-400 mb-8">Browse and join tournaments. Create your own from your profile.</p>
      <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center">
        <p className="text-gray-400 mb-4">No tournaments yet.</p>
        <Link to="/profile" className="text-accent hover:underline">Create one from your profile</Link>
      </div>
    </div>
  )
}
