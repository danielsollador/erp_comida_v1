/**
 * Que el ERP abra aunque no haya internet.
 *
 * Sin esto, la tablet sin conexion muestra la pantalla de error del navegador:
 * ni el menu, ni los pedidos del dia, ni forma de saber que pasa. Con esto
 * abre la aplicacion, que ya puede decir "sin conexion" con sus palabras.
 *
 * Reglas, en orden de cuidado:
 *
 * 1. `/api/` NUNCA se guarda. Un precio o un saldo viejo servido como bueno
 *    es peor que un error: la cajera cobraria con la tasa de ayer sin saberlo.
 * 2. Navegar va primero a la red y solo cae al cache si no hay. Asi un
 *    despliegue nuevo se ve de una, sin esperar a que caduque nada.
 * 3. Solo `/assets/` se sirve primero desde el cache, porque Vite le pone un
 *    hash en el nombre a cada archivo: si el contenido cambia, cambia el
 *    nombre. Nunca hay una version vieja pretendiendo ser la nueva.
 *
 * Para soltar el control (si algun dia estorba): borrar este archivo y
 * desplegar. El `activate` de abajo limpia los caches viejos y, sin archivo,
 * el navegador desregistra el worker en la siguiente carga.
 */

const CACHE = "savora-v1";
const ESENCIALES = ["/", "/index.html"];

self.addEventListener("install", (e) => {
  // No se espera a que las pestañas abiertas se cierren: en una tablet que
  // nunca se cierra, esperar significa no actualizar nunca.
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ESENCIALES).catch(() => {})),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Datos, sesion y login siempre a la red: aca no se adivina.
  if (url.pathname.startsWith("/api/") || url.pathname.endsWith(".html")) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/index.html"))),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then(
        (guardado) =>
          guardado ||
          fetch(req).then((res) => {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
            return res;
          }),
      ),
    );
  }
});
