// -----------------------------------------------------------------------------
// Every text the container writes, in the four languages of the Gladys
// interface. German says "du", Spanish says "usted" (test/i18n.test.js).
//
// Feature names are written once, when the user adds the device to Gladys
// (they are frozen at creation): they follow the `language` of the
// configuration, French by default. Messages shown under a button or in the
// connection status are multi-language objects: Gladys picks the language of
// the user reading them.
// -----------------------------------------------------------------------------

/** Feature and device names, one table per language. */
export const NAMES = {
  en: {
    state: 'Open / close',
    position: 'Position',
    bottomPosition: 'Bottom rail position',
    topPosition: 'Top rail position',
    combinedPosition: 'Combined position',
    frontPosition: 'Sheer (front) position',
    rearPosition: 'Blackout (rear) position',
    tilt: 'Slat tilt',
    battery: 'Battery',
    batteryLow: 'Low battery',
    activate: 'Run the scene',
    shade: 'Shade',
    scene: 'PowerView scene',
  },
  fr: {
    state: 'Ouvrir / fermer',
    position: 'Position',
    bottomPosition: 'Position du rail bas',
    topPosition: 'Position du rail haut',
    combinedPosition: 'Position combinée',
    frontPosition: 'Position du voilage (avant)',
    rearPosition: "Position de l'occultant (arrière)",
    tilt: 'Inclinaison des lamelles',
    battery: 'Batterie',
    batteryLow: 'Batterie faible',
    activate: 'Lancer la scène',
    shade: 'Store',
    scene: 'scène PowerView',
  },
  de: {
    state: 'Öffnen / Schließen',
    position: 'Position',
    bottomPosition: 'Position der unteren Schiene',
    topPosition: 'Position der oberen Schiene',
    combinedPosition: 'Kombinierte Position',
    frontPosition: 'Position des Voiles (vorne)',
    rearPosition: 'Position der Verdunkelung (hinten)',
    tilt: 'Lamellenneigung',
    battery: 'Batterie',
    batteryLow: 'Niedriger Batteriestand',
    activate: 'Szene starten',
    shade: 'Jalousie',
    scene: 'PowerView-Szene',
  },
  es: {
    state: 'Abrir / cerrar',
    position: 'Posición',
    bottomPosition: 'Posición del riel inferior',
    topPosition: 'Posición del riel superior',
    combinedPosition: 'Posición combinada',
    frontPosition: 'Posición del visillo (delante)',
    rearPosition: 'Posición del opaco (detrás)',
    tilt: 'Inclinación de las lamas',
    battery: 'Batería',
    batteryLow: 'Batería baja',
    activate: 'Ejecutar la escena',
    shade: 'Persiana',
    scene: 'escena PowerView',
  },
};

/** Fixed messages, as multi-language objects. */
export const TEXT = {
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  noHub: {
    en: 'No PowerView hub found: enter its IP address in the configuration.',
    fr: 'Aucun hub PowerView trouvé : saisissez son adresse IP dans la configuration.',
    de: 'Kein PowerView-Hub gefunden: Gib seine IP-Adresse in der Konfiguration ein.',
    es: 'No se ha encontrado ningún hub PowerView: introduzca su dirección IP en la configuración.',
  },
  hubsUnreachable: {
    en: 'The PowerView hub does not answer: check that it is powered and on the network.',
    fr: "Le hub PowerView ne répond pas : vérifiez qu'il est alimenté et sur le réseau.",
    de: 'Der PowerView-Hub antwortet nicht: Prüfe, ob er Strom hat und im Netzwerk ist.',
    es: 'El hub PowerView no responde: compruebe que está encendido y conectado a la red.',
  },
  notAShade: {
    en: 'This device is not a PowerView shade.',
    fr: "Cet appareil n'est pas un store PowerView.",
    de: 'Dieses Gerät ist keine PowerView-Jalousie.',
    es: 'Este dispositivo no es una persiana PowerView.',
  },
  notAScene: {
    en: 'Pick a PowerView scene, not a shade.',
    fr: 'Choisissez une scène PowerView, pas un store.',
    de: 'Wähle eine PowerView-Szene, keine Jalousie.',
    es: 'Elija una escena PowerView, no una persiana.',
  },
  unknownShade: {
    en: 'The hub no longer knows this shade: search for the hubs again.',
    fr: 'Le hub ne connaît plus ce store : relancez la recherche des hubs.',
    de: 'Der Hub kennt diese Jalousie nicht mehr: Starte die Suche nach den Hubs erneut.',
    es: 'El hub ya no conoce esta persiana: vuelva a buscar los hubs.',
  },
  unknownScene: {
    en: 'The hub no longer knows this scene: search for the hubs again.',
    fr: 'Le hub ne connaît plus cette scène : relancez la recherche des hubs.',
    de: 'Der Hub kennt diese Szene nicht mehr: Starte die Suche nach den Hubs erneut.',
    es: 'El hub ya no conoce esta escena: vuelva a buscar los hubs.',
  },
  hubUnreachable: {
    en: 'The hub of this device does not answer.',
    fr: 'Le hub de cet appareil ne répond pas.',
    de: 'Der Hub dieses Geräts antwortet nicht.',
    es: 'El hub de este dispositivo no responde.',
  },
  noStop: {
    en: 'A Generation 1 hub cannot stop a shade.',
    fr: 'Un hub de génération 1 ne sait pas arrêter un store.',
    de: 'Ein Hub der Generation 1 kann keine Jalousie anhalten.',
    es: 'Un hub de generación 1 no puede detener una persiana.',
  },
  jogged: {
    en: 'Look around: the shade moves up and down a little.',
    fr: 'Regardez autour de vous : le store monte et descend un peu.',
    de: 'Schau dich um: Die Jalousie fährt kurz hoch und runter.',
    es: 'Mire a su alrededor: la persiana sube y baja un poco.',
  },
};

/** The report of the "Search for hubs" action, one table per language. */
export const SEARCH_TEXT = {
  en: {
    none: 'No PowerView hub found.',
    hub: (hub) =>
      `${hub.name} (Gen ${hub.generation}, ${hub.host}): ${hub.shades} shade(s), ${hub.scenes} scene(s).`,
    secondary: (host) => `${host} is a secondary Gen 3 gateway: it is driven through the primary.`,
    unreachable: (host) => `${host} does not answer.`,
    noMdns: 'Automatic discovery (mDNS) through Gladys is unavailable: enter the IP addresses.',
    ignored: (list) => `Ignored addresses: ${list}.`,
    next: 'Open the Discover tab to add the shades and scenes.',
  },
  fr: {
    none: 'Aucun hub PowerView trouvé.',
    hub: (hub) =>
      `${hub.name} (génération ${hub.generation}, ${hub.host}) : ${hub.shades} store(s), ${hub.scenes} scène(s).`,
    secondary: (host) =>
      `${host} est une passerelle secondaire de génération 3 : elle est pilotée par la principale.`,
    unreachable: (host) => `${host} ne répond pas.`,
    noMdns:
      'La découverte automatique (mDNS) par Gladys est indisponible : saisissez les adresses IP.',
    ignored: (list) => `Adresses ignorées : ${list}.`,
    next: "Ouvrez l'onglet Découverte pour ajouter les stores et les scènes.",
  },
  de: {
    none: 'Kein PowerView-Hub gefunden.',
    hub: (hub) =>
      `${hub.name} (Generation ${hub.generation}, ${hub.host}): ${hub.shades} Jalousie(n), ${hub.scenes} Szene(n).`,
    secondary: (host) =>
      `${host} ist ein sekundäres Gateway der Generation 3: Es wird über das primäre gesteuert.`,
    unreachable: (host) => `${host} antwortet nicht.`,
    noMdns:
      'Die automatische Erkennung (mDNS) über Gladys ist nicht verfügbar: Gib die IP-Adressen ein.',
    ignored: (list) => `Ignorierte Adressen: ${list}.`,
    next: 'Öffne den Tab „Entdecken“, um die Jalousien und Szenen hinzuzufügen.',
  },
  es: {
    none: 'No se ha encontrado ningún hub PowerView.',
    hub: (hub) =>
      `${hub.name} (generación ${hub.generation}, ${hub.host}): ${hub.shades} persiana(s), ${hub.scenes} escena(s).`,
    secondary: (host) =>
      `${host} es una pasarela secundaria de generación 3: se controla a través de la principal.`,
    unreachable: (host) => `${host} no responde.`,
    noMdns:
      'El descubrimiento automático (mDNS) a través de Gladys no está disponible: introduzca las direcciones IP.',
    ignored: (list) => `Direcciones ignoradas: ${list}.`,
    next: 'Abra la pestaña Descubrir para añadir las persianas y las escenas.',
  },
};

/** The same text in every language, from a function of the language table. */
export function localize(table, render) {
  return Object.fromEntries(Object.entries(table).map(([lang, entry]) => [lang, render(entry)]));
}
