# El cambio a Google: paso a paso

Se hace **con Leider presente**, en un momento sin ventas (por la noche o antes
de abrir). Dura unos 20 minutos. Hostinger queda encendido una semana más como
respaldo; no se borra nada ese día.

**Por qué se reemplaza la base entera.** Desde el 5-oct la VM tiene una copia de
los datos y encima se hicieron pruebas: hay pedidos con los mismos ids y
contenido distinto en los dos servidores (en Hostinger el 373 es una venta real;
en la VM es una prueba). Los datos de la VM se descartan y entra un volcado
fresco de Hostinger.

## Antes (cualquier día previo, sin tocar nada)

- [ ] `integrar-daniel` desplegada y probada en la VM (`gcp/README.md`).
- [ ] VM en `e2-small` (ver `GCP.md`): la versión nueva lee facturas con IA y
      la micro va justa de memoria.
- [ ] Bajar el TTL de los registros DNS de `vertigopro.tech` a 300 s en el panel
      de Hostinger, al menos un día antes (así el cambio se propaga en minutos).
- [ ] Clave de Gemini en Secret Manager (`gemini-api-key`) y
      `erp-lector-facturas` = `gemini`; si no, queda en `prueba`.
- [ ] Los secretos `dominio-savora` y `dominio-hub` siguen con los `sslip.io`
      hasta el paso 5.

## El día

### 1. Congelar

Avisar al local: no se cobra nada hasta nuevo aviso (10-15 min).

### 2. Volcado final en Hostinger (desde la laptop, solo lectura de la base)

```bash
ssh root@2.25.223.224 'cd /docker/erp_comida_v1 && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db pg_dump -U vertigo -d vertigo -Fc </dev/null > /root/respaldos/cambio-gcp.dump && pg_restore --list /root/respaldos/cambio-gcp.dump | tail -1 && ls -la /root/respaldos/cambio-gcp.dump'
```

Y los conteos de referencia (se guardan para comparar):

```bash
ssh root@2.25.223.224 'docker exec -i erp_comida-db-1 psql -U vertigo -d vertigo -At' < gcp/conteos.sql
```

### 3. Llevar el volcado y los usuarios a la VM

```bash
scp root@2.25.223.224:/root/respaldos/cambio-gcp.dump ./vertigo.dump
ssh root@2.25.223.224 'docker cp erp_comida-backend-1:/compartido/users.json - | tar -xO' > users.json
ssh root@2.25.223.224 'docker cp erp_comida-backend-1:/compartido/roles.json - | tar -xO' > roles.json
gcloud compute scp vertigo.dump users.json roles.json gcp/conteos.sql gcp/cambio-restaurar.sh vertigo-erp:/tmp/ --zone=us-east1-b --tunnel-through-iap
gcloud compute ssh vertigo-erp --zone=us-east1-b --tunnel-through-iap --command='sudo mkdir -p /docker/erp/migracion && sudo mv /tmp/vertigo.dump /tmp/users.json /tmp/roles.json /docker/erp/migracion/ && sudo mv /tmp/conteos.sql /tmp/cambio-restaurar.sh /docker/erp/ && sudo chmod 700 /docker/erp/migracion'
```

Borrar las tres copias de la laptop en cuanto termine el paso 4.

### 4. Reemplazar la base de la VM — CONFIRMAR CON LEIDER ANTES

```bash
gcloud compute ssh vertigo-erp --zone=us-east1-b --tunnel-through-iap --command='sudo bash /docker/erp/cambio-restaurar.sh'
```

Los conteos que imprime al final tienen que ser **idénticos** a los del paso 2
(pedidos, último id, pagos, facturas, notas, cierres, asientos, productos,
ingredientes). Si uno difiere: parar y revisar; Hostinger sigue intacto.

### 5. Dominios reales en la VM

```bash
printf savora.vertigopro.tech | gcloud secrets versions add dominio-savora --data-file=-
printf vertigopro.tech | gcloud secrets versions add dominio-hub --data-file=-
gcloud compute ssh vertigo-erp --zone=us-east1-b --tunnel-through-iap --command='sudo google_metadata_script_runner startup'
```

Y `locales/savora.json` de la VM vuelve al dominio real (el del repo):

```bash
gcloud compute scp locales/savora.json vertigo-erp:/tmp/savora.json --zone=us-east1-b --tunnel-through-iap
gcloud compute ssh vertigo-erp --zone=us-east1-b --tunnel-through-iap --command='sudo mv /tmp/savora.json /docker/erp/locales/savora.json && sudo docker restart erp_comida-hub-backend-1 erp_comida-backend-1'
```

### 6. DNS (panel de Hostinger, con la sesión de Leider)

Registros A de `savora`, `@` y `www` → `35.231.43.80`. Traefik pide los
certificados solo en cuanto el nombre resuelva a la VM (1-3 minutos).

### 7. Verificar desde afuera

```bash
curl -sS "https://dns.google/resolve?name=savora.vertigopro.tech&type=A" | grep -o '"data":"[^"]*"'
curl -sS -o /dev/null -w "%{http_code} ssl=%{ssl_verify_result}\n" https://savora.vertigopro.tech/api/health
curl -sS -o /dev/null -w "%{http_code} ssl=%{ssl_verify_result}\n" https://vertigopro.tech/api/health
```

En la tablet del local: recargar, entrar y vender un pedido de prueba (y
anularlo). Descongelar.

## Después

- Hostinger encendido y sin uso 7 días. Luego, con confirmación: apagar los
  contenedores y cancelar el VPS.
- Datos fiscales de Savorella en Impuestos › Datos fiscales ("agente de
  retención" apagado) y la tasa a las facturas de compra viejas en los
  períodos abiertos (la declaración en Bs se bloquea sin ella).
- DNS a Cloud DNS y el nombre a Cloudflare (`GCP.md`), sin prisa.
- Actualizar `DESPLIEGUE.md` (el despliegue oficial pasa a ser `gcp/README.md`).
