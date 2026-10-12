/** Un boton chico de fila: cabe de a tres sin que la tabla se ensanche. */
export default function AccionFila({
  tono = 'normal',
  className = '',
  ...resto
}: { tono?: 'normal' | 'peligro' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...resto}
      className={`text-xs font-medium px-2.5 py-1 rounded-lg border whitespace-nowrap ${
        tono === 'peligro'
          ? 'border-peligro-200 text-peligro-600 hover:bg-peligro-50'
          : 'border-neutral-200 text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50'
      } ${className}`}
    />
  )
}
