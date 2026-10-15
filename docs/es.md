# PowerView

Controle sus persianas motorizadas **Hunter Douglas / Luxaflex PowerView**
desde Gladys, en local, a través de su hub PowerView: abrir, cerrar, detener,
fijar una posición, orientar las lamas, vigilar las baterías y ejecutar las
escenas guardadas en la aplicación PowerView. Sin cuenta en la nube ni
conexión a Internet: Gladys habla con el hub en su red doméstica, como lo
hace la aplicación PowerView.

**Desarrollada sin el hardware: sus comentarios son bienvenidos.** La
integración se escribió a partir de la API PowerView publicada y de las
respuestas reales de hubs que usan las pruebas de la integración de Home
Assistant, sin un hub a mano. Si algo no se comporta como se describe, abra
una incidencia en GitHub indicando la generación del hub y el modelo de la
persiana.

Esta integración no está afiliada a Hunter Douglas ni a Luxaflex, ni cuenta
con su aprobación. PowerView es una marca de Hunter Douglas.

## Qué necesita

- Un **hub PowerView**: el hub de generación 2 (redondo, llamado «PowerView
  Hub») o una **pasarela de generación 3** (PowerView Gen 3, «Pro» o
  «Gateway»). El antiguo hub de generación 1 también funciona, sin la orden
  de detener.
- Persianas ya emparejadas con el hub en la **aplicación PowerView**. Las
  habitaciones y las escenas también se crean en la aplicación: Gladys las
  lee.
- Gladys 5.1 o posterior, en la misma red que el hub. El hub no pide
  contraseña: su API local está abierta a la red de la casa.

## Configuración

1. Instale la integración desde **Integraciones → Instalar desde GitHub**, o
   desde la tienda.
2. Abra su pestaña **Configuración**. Los hubs de la misma red que Gladys se
   encuentran automáticamente (mDNS). Si falta el suyo, introduzca su
   dirección IP en **Direcciones IP de los hubs** (varias direcciones
   separadas por comas). En una casa de generación 3 con varias pasarelas,
   basta con la pasarela **principal**: las demás solo retransmiten la radio.
3. Elija el **idioma de los nombres de las funciones** (francés por
   defecto): Gladys conserva un nombre una vez añadido el dispositivo.
4. Deje el **intervalo de actualización** en 60 segundos salvo que tenga un
   motivo: es la frecuencia con la que se leen las posiciones en el hub (de
   30 a 600 segundos).
5. Abra la pestaña **Descubrir**: aparecen todas las persianas y todas las
   escenas PowerView. Añada las que desee.

Asigne al hub una dirección IP fija en su router: si su dirección cambia, la
integración lo vuelve a buscar por mDNS, pero una dirección fija es lo más
seguro.

## Qué ofrece cada dispositivo

### Persianas

Cada persiana es un dispositivo de la categoría **Persiana** (o **Cortina**
para las que se desplazan hacia un lado: paneles Skyline, cortinas, lamas
verticales):

- **Abrir / cerrar**: los botones abrir, detener y cerrar de Gladys. La
  persiana aparece **abierta** en cuanto está parcialmente abierta, y
  **cerrada** cuando está completamente bajada.
- **Posición**: 0 % es cerrada, 100 % es abierta. En una persiana que baja
  desde arriba (top-down), 100 % sigue siendo «abierta»: la integración
  invierte el valor por usted.

Tras una orden, Gladys muestra enseguida la posición de destino; después la
integración pregunta a la persiana dónde está realmente, una vez que su motor
debería haberse detenido (unos 40 segundos para un recorrido completo).

### Lamas

Las persianas con lamas (Silhouette, Pirouette, Twist, venecianas, lamas
verticales, contraventanas Palm Beach…) tienen un segundo control
deslizante, **Inclinación de las lamas**, de 0 a 100 %:

- lamas que giran **90°** (Silhouette, Pirouette): 0 % cerradas, 100 %
  abiertas;
- lamas que giran **180°** (venecianas, Twist, lamas verticales,
  contraventanas): 50 % es abierto (horizontal), 0 % y 100 % son cerrado en
  un sentido u otro.

Algunas persianas solo orientan sus lamas una vez completamente cerradas
(Silhouette, Pirouette): el hub se encarga. Las persianas solo de lamas (Palm
Beach, Everwood) no tienen control de posición: abrir y cerrar orientan las
lamas.

### Persianas de dos rieles y persianas dobles

- Persianas **de arriba abajo y de abajo arriba** (Duette TDBU): **Posición
  del riel inferior** (100 % = riel inferior arriba) y **Posición del riel
  superior** (100 % = riel superior abajo). Un riel nunca cruza el otro: la
  integración lo detiene al llegar al otro.
- Persianas **dobles** (Duolite, Vignette Duolite, Silhouette Duolite: un
  visillo delante y un tejido opaco detrás, con un solo motor): **Posición
  combinada** (0-50 % el opaco, 51-100 % el visillo, abierta al 100 %), más
  **Posición del visillo (delante)** y **Posición del opaco (detrás)**. El
  visillo solo se abre cuando el opaco está totalmente subido.

### Batería

Las persianas con baterías (o varillas recargables) tienen **Batería** (%) y
**Batería baja** (sí al 20 % o menos, útil para lanzar un recordatorio). Un
hub de generación 2 indica la tensión del paquete, una pasarela de
generación 3 un nivel en cuatro escalones (100, 50, 20 y 0 %). Las persianas
conectadas a la red eléctrica no tienen función de batería.

### Escenas PowerView

Cada escena de la aplicación PowerView es un dispositivo llamado «_escena_
(escena PowerView)», con un botón **Ejecutar la escena**. Añada las que
utilice: se pueden poner en un panel y usar en las escenas de Gladys.

## Acciones

En la pestaña **Configuración**:

- **Buscar los hubs**: vuelve a buscar los hubs (por ejemplo, después de
  añadir una persiana o una escena en la aplicación PowerView) e indica lo
  que tiene cada uno: generación, dirección, número de persianas y de
  escenas. También se señalan una pasarela secundaria de generación 3, una
  dirección que no responde o una dirección mal escrita.
- **Identificar una persiana**: elija una persiana; sube y baja un poco para
  saber de qué ventana se trata.

## Escenas

La integración añade la acción **Ejecutar una escena PowerView** al editor de
escenas (categoría **Integraciones**). Elija la escena entre sus
dispositivos (los llamados «(escena PowerView)»); la acción devuelve
**Persianas movidas**, el número de persianas que mueve el hub, para las
acciones siguientes.

Las persianas son dispositivos normales de Gladys: la acción **Establecer
valor del dispositivo** abre, cierra o fija una posición, y el disparador
**Cambio de estado del dispositivo** reacciona a una posición o a una
batería baja.

Ejemplos:

- **Despertar suave**: a las 7:30 los días laborables, poner la persiana del
  dormitorio al 30 %, y al 100 % un cuarto de hora después.
- **Tarde de verano**: cuando la temperatura exterior supere los 28 °C,
  ejecutar la escena PowerView «Cerrar sur»; volver a abrir las persianas al
  atardecer.
- **Recordatorio de batería**: cuando **Batería baja** de una persiana pase
  a sí, enviarse un mensaje para recargarla.

## Panel

Sin widget propio: las persianas y las escenas son dispositivos, y la caja
**Dispositivos** de Gladys los muestra con sus botones y controles.

## Actualización y carga del hub

- En cada **intervalo de actualización** (60 segundos por defecto), la
  integración lee la lista de persianas de cada hub que tenga al menos una
  persiana añadida a Gladys. El hub responde de memoria: las persianas **no
  se despiertan** y sus baterías se conservan.
- A las persianas **conectadas a la red eléctrica** también se les pregunta
  por radio su posición real cada 10 minutos, de una en una (como hace Home
  Assistant). A las persianas con baterías nunca se les pregunta a
  intervalos fijos: las vaciaría en pocos días. Por eso, una persiana con
  baterías movida con un mando solo muestra su nueva posición cuando el hub
  la conoce (una pasarela de generación 3 suele oír sus persianas, un hub de
  generación 2 a menudo no).
- Tras una orden, se pregunta a la persiana cuando su motor se ha detenido.
- Las operaciones de radio (movimientos, paradas, escenas) salen **de una en
  una** por hub: se sabe que los hubs se bloquean cuando reciben varias a la
  vez.

La API PowerView no tiene una cuota publicada; estos ritmos son los que Home
Assistant usa desde hace años.

## Solución de problemas

- **No se encuentra ningún hub**: compruebe que Gladys y el hub están en la
  misma red (misma subred); después introduzca la dirección IP del hub en la
  configuración y ejecute **Buscar los hubs**. Algunos routers filtran el
  mDNS entre la red Wi-Fi y la red cableada.
- **El estado indica que el hub no responde**: un hub de generación 2 se
  reinicia cada noche durante unos minutos; la integración lo espera en
  silencio. Si se prolonga, desenchufe el hub y vuelva a enchufarlo.
- **Una posición no sigue al mando**: consulte «Actualización y carga del
  hub» más arriba. Abrir una vez la persiana desde Gladys la vuelve a
  sincronizar.
- **Falta una persiana o una escena nueva**: ejecute **Buscar los hubs** y
  abra después la pestaña **Descubrir**.
- **Más detalles**: la integración solo registra su ciclo de vida (inicio,
  hubs encontrados, perdidos y recuperados, una línea por orden). Ajuste
  `LOG_LEVEL=debug` en el contenedor para verlo todo.

## Límites

- Desarrollada sin el hardware: las respuestas de los hubs proceden de las
  pruebas de Home Assistant. Sus comentarios son bienvenidos.
- La luz integrada de las persianas iluminadas Aura no se controla.
- Las programaciones PowerView (automatizaciones) se quedan en la aplicación
  PowerView.
- Gladys no tiene una función de «inclinación»: las lamas son un segundo
  control de posición, y los asistentes de voz solo ven la posición
  principal.
- El hub de generación 1 no puede detener una persiana.
- Las pasarelas de generación 3 se anuncian como `_PowerView-G3._tcp`,
  mientras que Gladys solo puede buscar `_powerview-g3._tcp` (en
  minúsculas): puede que no se encuentren automáticamente. En ese caso,
  introduzca la dirección IP de la pasarela.
- Gladys conserva los nombres y las funciones de un dispositivo una vez
  añadido: una persiana emparejada de nuevo en la aplicación PowerView recibe
  un identificador nuevo, y por tanto un dispositivo nuevo.
