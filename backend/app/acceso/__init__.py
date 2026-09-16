"""Acceso al ERP: sesiones firmadas, usuarios con rol y pases entre dominios.

Portado del panel multimarca de REM Venezuela y adaptado a un local de comida.
Los tres modulos se leen en este orden:

  sesion.py    el token: quien eres, hasta cuando, y una firma HMAC.
  usuarios.py  el archivo users.json: alta, clave, rol, locales asignados.
  auth.py      la cookie, la puerta y el limite de intentos por IP.
  permisos.py  que puede hacer cada rol (admin, caja, cocina).
"""
