# Fixes

Lo que falla, un renglón por arreglo con dónde pasa. Se arreglan con `/arreglar`.

- [x] `npm run glosario` fallaba con 29 explicaciones sin usar · resuelto 2026-11-02, commit a5035af
- [x] La ficha de mercancía de la app no preguntaba "Cómo te llega" ni el precio por empaque (Inventario > ficha) · resuelto 2026-11-02, commit c038405
- [ ] Ninguna tabla se exporta a CSV ni a Excel desde el componente `Tabla` (solo hay descargas sueltas en Impuestos, Reportes a medida e Inventario), y hay tablas hechas con `<table>` suelto que no se ordenan ni explican sus columnas (todos los módulos)
