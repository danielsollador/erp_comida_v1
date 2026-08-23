import { Link } from 'react-router-dom'

export default function NavBar({ titulo, dark = false }: { titulo: string; dark?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-b sticky top-0 z-20 ${
        dark
          ? 'bg-neutral-900/95 backdrop-blur text-white border-neutral-800'
          : 'bg-white/95 backdrop-blur border-neutral-200'
      }`}
    >
      <Link
        to="/"
        className={`text-sm px-3 py-2 rounded-lg font-medium flex items-center gap-1.5 ${
          dark ? 'bg-neutral-800 hover:bg-neutral-700' : 'bg-neutral-100 hover:bg-neutral-200'
        }`}
      >
        <span aria-hidden>←</span> Menu
      </Link>
      <div className="w-px h-6 bg-current opacity-15" />
      <h1 className="font-semibold text-lg tracking-tight">{titulo}</h1>
    </div>
  )
}
