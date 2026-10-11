// Default categories and keyword hints used to suggest a category for
// merchants the app has never seen. Hints only *suggest*: the first time a
// merchant appears you confirm it, and from then on a learned rule applies it
// automatically.
//
// kind:   income | expense | saving | transfer
// nature: fixed (recurring bills) | variable (day-to-day) | oneoff (occasional)
// need:   true = necesidad, false = deseo (used for the 50/30/20 read-out)

export const DEFAULT_CATEGORIES = [
  { id: 'nomina', name: 'Salary', kind: 'income', icon: '💼', color: '#2f9e6b' },
  { id: 'ingresos-otros', name: 'Other income', kind: 'income', icon: '➕', color: '#5fbf8f' },
  { id: 'intereses', name: 'Interest & dividends', kind: 'income', icon: '💰', color: '#3fae7a' },
  { id: 'saveback', name: 'Saveback & bonuses', kind: 'income', reward: true, icon: '🎁', color: '#7cc79f' },

  { id: 'inversion', name: 'Investing', kind: 'saving', icon: '📈', color: '#3b6fd9' },
  { id: 'ahorro', name: 'Savings', kind: 'saving', icon: '🏦', color: '#6d93e6' },

  { id: 'traspaso', name: 'Transfer between accounts', kind: 'transfer', icon: '🔁', color: '#9aa1ab' },

  { id: 'vivienda', name: 'Housing', kind: 'expense', nature: 'fixed', need: true, icon: '🏠', color: '#c2553b' },
  { id: 'suministros', name: 'Utilities', kind: 'expense', nature: 'fixed', need: true, icon: '💡', color: '#d9822b' },
  { id: 'telefonia', name: 'Phone & internet', kind: 'expense', nature: 'fixed', need: true, icon: '📶', color: '#b8862e' },
  { id: 'seguros', name: 'Insurance', kind: 'expense', nature: 'fixed', need: true, icon: '🛡️', color: '#8a6d3b' },
  { id: 'suscripciones', name: 'Subscriptions', kind: 'expense', nature: 'fixed', need: false, icon: '🔂', color: '#9c4dcc' },
  { id: 'supermercado', name: 'Groceries', kind: 'expense', nature: 'variable', need: true, icon: '🛒', color: '#3d9a8b' },
  { id: 'transporte', name: 'Transport', kind: 'expense', nature: 'variable', need: true, icon: '🚇', color: '#4a7f9e' },
  { id: 'salud', name: 'Health', kind: 'expense', nature: 'variable', need: true, icon: '🩺', color: '#d1495b' },
  { id: 'restaurantes', name: 'Restaurants & bars', kind: 'expense', nature: 'variable', need: false, icon: '🍽️', color: '#e07a5f' },
  { id: 'delivery', name: 'Food delivery', kind: 'expense', nature: 'variable', need: false, icon: '🛵', color: '#e8a87c' },
  { id: 'ocio', name: 'Leisure & culture', kind: 'expense', nature: 'variable', need: false, icon: '🎟️', color: '#c06c84' },
  { id: 'deporte', name: 'Sport', kind: 'expense', nature: 'fixed', need: false, icon: '🏋️', color: '#6c8e3e' },
  { id: 'cuidado', name: 'Personal care', kind: 'expense', nature: 'variable', need: false, icon: '💈', color: '#b5838d' },
  { id: 'compras', name: 'Shopping', kind: 'expense', nature: 'oneoff', need: false, icon: '🛍️', color: '#7b6bb0' },
  { id: 'viajes', name: 'Travel', kind: 'expense', nature: 'oneoff', need: false, icon: '✈️', color: '#2a9dc4' },
  { id: 'regalos', name: 'Gifts', kind: 'expense', nature: 'oneoff', need: false, icon: '🎁', color: '#d4598c' },
  { id: 'formacion', name: 'Education', kind: 'expense', nature: 'oneoff', need: true, icon: '📚', color: '#5a6fa8' },
  { id: 'impuestos', name: 'Taxes & fees', kind: 'expense', nature: 'oneoff', need: true, icon: '🏛️', color: '#6b705c' },
  { id: 'comisiones', name: 'Bank fees', kind: 'expense', nature: 'variable', need: true, icon: '🧾', color: '#8d8d8d' },
  { id: 'efectivo', name: 'Cash', kind: 'expense', nature: 'variable', need: false, icon: '💶', color: '#a3a380' },
  { id: 'bizum', name: 'Bizum & payments to people', kind: 'expense', nature: 'variable', need: false, icon: '📲', color: '#5e8c9a' },
  { id: 'otros', name: 'Other expenses', kind: 'expense', nature: 'variable', need: false, icon: '•', color: '#a0a6ad' },
];

// Keywords are matched against the cleaned, upper-cased description.
// Order matters: the first matching group wins.
// Spanish names of the default categories (before the app switched to
// English): migrated to the English name if the user never renamed them.
export const LEGACY_CATEGORY_NAMES = {"Nómina": "Salary", "Otros ingresos": "Other income", "Intereses y dividendos": "Interest & dividends", "Saveback y bonos": "Saveback & bonuses", "Inversión": "Investing", "Ahorro": "Savings", "Traspaso entre cuentas": "Transfer between accounts", "Vivienda": "Housing", "Suministros": "Utilities", "Teléfono e internet": "Phone & internet", "Seguros": "Insurance", "Suscripciones": "Subscriptions", "Supermercado": "Groceries", "Transporte": "Transport", "Salud": "Health", "Restaurantes y bares": "Restaurants & bars", "Comida a domicilio": "Food delivery", "Ocio y cultura": "Leisure & culture", "Deporte": "Sport", "Cuidado personal": "Personal care", "Compras": "Shopping", "Viajes": "Travel", "Regalos": "Gifts", "Formación": "Education", "Impuestos y tasas": "Taxes & fees", "Comisiones bancarias": "Bank fees", "Efectivo": "Cash", "Bizum y pagos a personas": "Bizum & payments to people", "Otros gastos": "Other expenses"};

export const KEYWORD_HINTS = [
  ['traspaso', ['TRASPASO', 'TRANSFERENCIA ENTRE CUENTAS', 'TRANSFER TO OWN', 'OWN ACCOUNT', 'CUENTA PROPIA']],
  ['inversion', ['SAVINGS PLAN', 'SPARPLAN', 'PLAN DE INVERSION', 'BUY TRADE', 'ORDEN DE COMPRA', 'COMPRA VALORES', 'SUSCRIPCION FONDO', 'INDEXA', 'MYINVESTOR', 'FINIZENS', 'INBESTME', 'ROUND UP', 'ETF', 'BROKER']],
  ['nomina', ['NOMINA', 'NÓMINA', 'SALARIO', 'PAYROLL', 'SALARY']],
  ['impuestos', ['AEAT', 'AGENCIA TRIBUTARIA', 'HACIENDA', 'IBI ', 'AJUNTAMENT', 'AYUNTAMIENTO', 'SEGURIDAD SOCIAL', 'TGSS', 'DGT ', 'TASA ']],
  ['comisiones', ['COMISION', 'COMISIÓN', 'MANTENIMIENTO CUENTA', 'CUOTA TARJETA', 'FEE ']],
  ['efectivo', ['CAJERO', 'RETIRADA EFECTIVO', 'REINTEGRO', 'ATM ', 'CASH WITHDRAWAL']],
  ['supermercado', ['MERCADONA', 'LIDL', 'CARREFOUR', 'ALDI', 'SUPERMERCADO', 'SUPERMERCAT', 'BONPREU', 'BON PREU', 'BONAREA', 'CONDIS', 'CAPRABO', 'CONSUM', 'EROSKI', 'ALCAMPO', 'AHORRAMAS', 'SPAR ', 'DIA ', 'SUPERCOR', 'HIPERCOR', 'ESCLAT', 'VERITAS', 'GADIS', 'FROIZ', 'MAKRO', 'COSTCO', 'FRUTERIA', 'CARNICERIA', 'PANADERIA', 'FORN ']],
  ['delivery', ['GLOVO', 'JUST EAT', 'JUSTEAT', 'UBER EATS', 'UBEREATS', 'DELIVEROO', 'TELEPIZZA', 'DOMINOS', 'TOO GOOD TO GO']],
  ['restaurantes', ['RESTAURANTE', 'RESTAURANT', 'CAFETERIA', 'CAFE ', 'BAR ', 'TABERNA', 'CERVECERIA', 'STARBUCKS', 'MCDONALDS', 'MC DONALDS', 'BURGER KING', 'KFC', 'FOSTERS', 'TGB', 'GOIKO', 'VIPS', '100 MONTADITOS', 'TAPAS', 'PIZZERIA', 'SUSHI', 'GRANJA', 'BRUNCH']],
  ['transporte', ['RENFE', 'RODALIES', 'TMB', 'METRO', 'FGC', 'EMT', 'AUTOBUS', 'BICING', 'UBER', 'CABIFY', 'BOLT', 'FREENOW', 'FREE NOW', 'TAXI', 'REPSOL', 'CEPSA', 'MOEVE', 'GALP', 'PETRONOR', 'BALLENOIL', 'PLENOIL', 'SHELL', 'BP ', 'GASOLINERA', 'AUTOPISTA', 'PEAJE', 'AUTEMA', 'PARKING', 'APARCAMIENTO', 'SABA', 'EMPARK', 'TELPARK', 'ITV', 'TALLER', 'CAR2GO', 'SHARE NOW', 'ZITY', 'COOLTRA', 'ACCIONA MOBILITY', 'BLABLACAR', 'ALSA', 'OUIGO', 'IRYO']],
  ['suscripciones', ['NETFLIX', 'SPOTIFY', 'HBO', 'DISNEY', 'PRIME VIDEO', 'AMAZON PRIME', 'PRIMEVIDEO', 'YOUTUBE', 'APPLE.COM', 'APPLE COM BILL', 'ITUNES', 'ICLOUD', 'GOOGLE ONE', 'GOOGLE STORAGE', 'CHATGPT', 'OPENAI', 'ANTHROPIC', 'CLAUDE.AI', 'DAZN', 'FILMIN', 'MOVISTAR PLUS', 'AUDIBLE', 'KINDLE UNLIMITED', 'PATREON', 'DROPBOX', 'NOTION', 'ADOBE', 'MICROSOFT', 'DUOLINGO', 'STRAVA', 'MEDIUM', 'SUBSTACK']],
  ['telefonia', ['MOVISTAR', 'VODAFONE', 'ORANGE', 'DIGI ', 'DIGI MOBIL', 'PEPEPHONE', 'SIMYO', 'LOWI', 'MASMOVIL', 'MÁSMÓVIL', 'JAZZTEL', 'YOIGO', 'O2 ', 'FINETWORK', 'AVATEL', 'PARLEM', 'ADAMO']],
  ['suministros', ['ENDESA', 'IBERDROLA', 'NATURGY', 'HOLALUZ', 'TOTALENERGIES', 'REPSOL LUZ', 'OCTOPUS', 'LUCERA', 'SOM ENERGIA', 'AIGUES', 'AGUAS DE', 'AGBAR', 'CANAL DE ISABEL', 'GAS NATURAL', 'ELECTRICIDAD', 'BUTANO']],
  ['seguros', ['SEGURO', 'ASEGURADORA', 'MAPFRE', 'AXA', 'ALLIANZ', 'MUTUA', 'GENERALI', 'LINEA DIRECTA', 'LÍNEA DIRECTA', 'ZURICH', 'SANTALUCIA', 'OCASO', 'CASER', 'REALE', 'VERTI', 'OCCIDENT', 'SEGURCAIXA', 'VIDACAIXA']],
  ['salud', ['FARMACIA', 'CLINICA', 'CLÍNICA', 'DENTAL', 'DENTISTA', 'HOSPITAL', 'SANITAS', 'ADESLAS', 'DKV', 'ASISA', 'QUIRON', 'OPTICA', 'ÓPTICA', 'FISIOTERAP', 'PSICOLOG', 'MEDICO', 'MEDICA', 'MEDICAL', 'LABORATORIO']],
  ['deporte', ['GIMNASIO', 'GYM', 'DIR ', 'BASIC FIT', 'BASIC-FIT', 'HOLMES PLACE', 'ANYTIME FITNESS', 'METROPOLITAN', 'SIDECAR', 'DECATHLON', 'PADEL', 'CROSSFIT', 'YOGA', 'PISCINA', 'BUCEO', 'DIVING', 'FITNESS']],
  ['viajes', ['RYANAIR', 'VUELING', 'IBERIA', 'AIR EUROPA', 'EASYJET', 'WIZZ', 'BOOKING', 'AIRBNB', 'HOTEL', 'HOSTAL', 'EXPEDIA', 'EDREAMS', 'SKYSCANNER', 'TRAINLINE', 'AEROPUERTO', 'AIRPORT', 'HERTZ', 'AVIS', 'SIXT', 'EUROPCAR', 'GOLDCAR']],
  ['ocio', ['CINE', 'CINESA', 'YELMO', 'TEATRO', 'MUSEO', 'MUSEU', 'CONCIERTO', 'TICKETMASTER', 'ENTRADAS', 'FEVER', 'DICE.FM', 'STEAM', 'PLAYSTATION', 'NINTENDO', 'XBOX', 'FNAC', 'CASA DEL LIBRO', 'LIBRERIA', 'LLIBRERIA']],
  ['cuidado', ['PELUQUERIA', 'PERRUQUERIA', 'BARBERIA', 'BARBER', 'ESTETICA', 'SEPHORA', 'DRUIDE', 'PRIMOR', 'DOUGLAS', 'MARIONNAUD', 'KIKO']],
  ['compras', ['AMAZON', 'AMZN', 'ZARA', 'MANGO', 'H&M', 'PULL&BEAR', 'BERSHKA', 'MASSIMO DUTTI', 'UNIQLO', 'PRIMARK', 'IKEA', 'LEROY MERLIN', 'BAUHAUS', 'MEDIA MARKT', 'MEDIAMARKT', 'EL CORTE INGLES', 'CORTE INGLES', 'ALIEXPRESS', 'SHEIN', 'TEMU', 'ZALANDO', 'WALLAPOP', 'VINTED', 'APPLE STORE', 'PCCOMPONENTES', 'NORMAL ', 'TIGER', 'ACTION ', 'CORTEFIEL', 'SPRINGFIELD', 'DRUNI']],
  ['formacion', ['UDEMY', 'COURSERA', 'DOMESTIKA', 'PLATZI', 'UNIVERSIDAD', 'UNIVERSITAT', 'ACADEMIA', 'ESCUELA', 'MASTER ', 'CURSO']],
  ['vivienda', ['ALQUILER', 'LLOGUER', 'HIPOTECA', 'COMUNIDAD DE PROPIETARIOS', 'COMUNIDAD PROP', 'COMUNITAT', 'RENT ']],
  ['bizum', ['BIZUM ENVIADO', 'BIZUM A ', 'BIZUM PARA']],
  ['saveback', ['SAVEBACK', 'CASHBACK']],
  ['intereses', ['INTERESES', 'INTEREST', 'DIVIDEND', 'DIVIDENDO', 'LIQUIDACION INTERESES']],
  ['ingresos-otros', ['BIZUM RECIBIDO', 'BIZUM DE ', 'DEVOLUCION HACIENDA', 'ABONO']],
];

export function defaultState() {
  return {
    version: 1,
    accounts: [],
    importProfiles: {},
    categories: DEFAULT_CATEGORIES.map(c => ({ ...c })),
    rules: [],
    transactions: [],
    imports: [],
    budgets: {},
    trips: [],
    settings: {
      oneOffThreshold: 150,
      savingsGoalRate: 0.2,
      // Trade Republic Saveback terms (editable in Ajustes; check TR's current conditions).
      saveback: { rate: 0.01, spendCap: 1500, monthlyCap: 15, minPlan: 50 },
    },
  };
}
