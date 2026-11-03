# FIXES (Arreglos y mejoras en el proyecto)

Se trabajan con `/arreglar`. Un renglon por arreglo, diciendo que falla y donde:

- `- [ ] El cierre de caja suma mal el vuelto en divisas (Caja > Cierre)` pendiente
- `- [x] ... · resuelto AAAA-MM-DD, commit abc1234` resuelto

## Correcciones 1

- [x] `npm run glosario` falla: 29 explicaciones de `lib/glosario.ts` que la web ya no usa. Ya fallaba en `origin/master` del 2-nov. · resuelto 2026-11-02, commit a5035af (12 se usaban y el script no las veia; 17 eran de pantallas rehechas y se quitaron)
- [x] La ficha de mercancia de la app movil no esta igual que la de la web: le falta "Como te llega" (suelta o en empaque) y el precio por empaque (Inventario > ficha de mercancia). · resuelto 2026-11-02, commit c038405

