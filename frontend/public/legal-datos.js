/*
 * Edita aquí el nombre legal de la empresa y el correo de soporte; las tres
 * páginas los toman de este archivo.
 *
 * Lo leen privacidad.html, soporte.html y eliminar-cuenta.html (públicas, sin
 * sesión: la App Store pide sus URLs). Cada página ya trae estos mismos
 * valores escritos en el HTML, así que si este archivo no carga nunca queda
 * vacía; este script solo los reemplaza. Si cambias algo aquí, cambia también
 * el texto de respaldo de las páginas (búscalo con `data-legal`).
 *
 * Marcas que entiende, en cualquier elemento:
 *   data-legal="empresa" | "correo" | "telefono" | "pais" | "actualizada"  -> pone el texto
 *   en un <a data-legal="correo"> además pone href="mailto:..."
 *   en un <a data-legal="telefono"> además pone href="https://wa.me/..." (el WhatsApp)
 */
window.VP_LEGAL = {
  empresa: 'Vertigo',
  correo: 'leideriverson@gmail.com',
  // El telefono como se lee, y el mismo numero para WhatsApp: con codigo de
  // pais y sin espacios ('584121234567'). Vacio = el sitio no muestra el boton.
  telefono: '+58 414 894 4748',
  whatsapp: '584148944748',
  pais: 'Venezuela',
  actualizada: '12 de octubre de 2026',
};

(function () {
  function pintar() {
    var datos = window.VP_LEGAL || {};
    var marcados = document.querySelectorAll('[data-legal]');
    for (var i = 0; i < marcados.length; i++) {
      var el = marcados[i];
      var valor = datos[el.getAttribute('data-legal')];
      if (!valor) continue;
      el.textContent = valor;
      if (el.tagName === 'A' && el.getAttribute('data-legal') === 'correo') {
        el.setAttribute('href', 'mailto:' + valor);
      }
      if (el.tagName === 'A' && el.getAttribute('data-legal') === 'telefono' && datos.whatsapp) {
        el.setAttribute('href', 'https://wa.me/' + String(datos.whatsapp).replace(/\D/g, ''));
      }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pintar);
  } else {
    pintar();
  }
})();
