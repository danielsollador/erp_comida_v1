import { Link } from 'react-router-dom'

export default function NavBar({ titulo, dark = false }: { titulo: string; dark?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-b ${
        dark ? 'bg-neutral-900 text-white border-neutral-700' : 'bg-white border-neutral-200'
      }`}
    >
      <Link
        to="/"
        className={`text-sm px-3 py-1.5 rounded-lg font-medium ${
          dark ? 'bg-neutral-700 hover:bg-neutral-600' : 'bg-neutral-100 hover:bg-neutral-200'
        }`}
      >
        Menu principal
      </Link>
      <h1 className="font-semibold text-lg">{titulo}</h1>
    </div>
  )
}
