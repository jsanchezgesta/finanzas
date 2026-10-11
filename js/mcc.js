// Merchant Category Codes (ISO 18245) → app category. Trade Republic card
// rows carry the MCC, which gives a reliable suggestion for new merchants.

const RANGES = [
  [[4111, 4131], 'transporte'], [[4784, 4784], 'transporte'], [[4121, 4121], 'transporte'], [[5541, 5542], 'transporte'],
  [[7523, 7523], 'transporte'], [[7531, 7549], 'transporte'], [[5511, 5599], 'transporte'],
  [[3000, 3350], 'viajes'], [[4511, 4511], 'viajes'], [[4411, 4411], 'viajes'], [[4722, 4722], 'viajes'], [[3351, 3500], 'viajes'],
  [[3501, 3999], 'viajes'], [[7011, 7012], 'viajes'], [[7512, 7519], 'viajes'],
  [[5411, 5411], 'supermercado'], [[5422, 5422], 'supermercado'], [[5441, 5441], 'supermercado'], [[5451, 5451], 'supermercado'],
  [[5462, 5462], 'supermercado'], [[5499, 5499], 'supermercado'], [[5331, 5331], 'supermercado'],
  [[5812, 5813], 'restaurantes'], [[5814, 5814], 'restaurantes'],
  [[5912, 5912], 'salud'], [[8011, 8099], 'salud'], [[8021, 8021], 'salud'], [[8043, 8043], 'salud'], [[5975, 5976], 'salud'],
  [[7997, 7997], 'deporte'], [[7941, 7941], 'deporte'], [[5940, 5941], 'deporte'], [[7992, 7992], 'deporte'],
  [[4812, 4816], 'telefonia'], [[4899, 4899], 'suscripciones'], [[5815, 5818], 'suscripciones'], [[5968, 5968], 'suscripciones'],
  [[4900, 4900], 'suministros'],
  [[6300, 6399], 'seguros'], [[5960, 5960], 'seguros'],
  [[7230, 7230], 'cuidado'], [[7297, 7298], 'cuidado'], [[5977, 5977], 'cuidado'],
  [[7832, 7833], 'ocio'], [[7922, 7929], 'ocio'], [[7991, 7991], 'ocio'], [[7993, 7996], 'ocio'], [[7998, 7999], 'ocio'],
  [[5942, 5942], 'ocio'], [[5945, 5945], 'ocio'], [[5735, 5735], 'ocio'],
  [[8211, 8299], 'formacion'],
  [[9311, 9311], 'impuestos'], [[9222, 9222], 'impuestos'], [[9399, 9399], 'impuestos'],
  [[6011, 6011], 'efectivo'], [[6010, 6010], 'efectivo'],
  [[5193, 5193], 'regalos'], [[5992, 5992], 'regalos'], [[5947, 5947], 'regalos'],
  [[5200, 5399], 'compras'], [[5600, 5699], 'compras'], [[5700, 5799], 'compras'], [[5900, 5999], 'compras'], [[5000, 5199], 'compras'],
];

export function mccCategory(code) {
  const n = parseInt(String(code ?? '').trim(), 10);
  if (!isFinite(n)) return null;
  for (const [[a, b], cat] of RANGES) if (n >= a && n <= b) return cat;
  return null;
}
