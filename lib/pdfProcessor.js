import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
}

export const DEFAULT_PRODUCTS = [
  { name: 'Tobillera',   weight: 0.235 },
  { name: 'Codera',      weight: 0.280 },
  { name: 'Rodillera',   weight: 0.500 },
  { name: 'Gorro',       weight: 0.400 },
  { name: 'Medias Spa',  weight: 0.100 },
];

// Mapeo de nombres de TiendaNube → nombres internos.
// Los productos pueden tener variantes/talles (ej: "Tobillera Talle M").
// Se matchea por substring case-insensitive, primer match gana.
const TIENDANUBE_NAME_MAP = [
  { match: 'tobillera',  internal: 'Tobillera'  },
  { match: 'codera',     internal: 'Codera'     },
  { match: 'rodillera',  internal: 'Rodillera'  },
  { match: 'gorro',      internal: 'Gorro'      },
  { match: 'medias spa', internal: 'Medias Spa' },
  { match: 'medias',     internal: 'Medias Spa' },
];

// Productos que tienen talles y deben mostrarse por separado (ej: "Rodillera M")
const PRODUCTS_WITH_SIZE = ['rodillera', 'codera'];

function mapTiendaNubeName(rawName, variantValues) {
  const lower = rawName.toLowerCase();
  for (const { match, internal } of TIENDANUBE_NAME_MAP) {
    if (lower.includes(match)) {
      // Si el producto tiene talles, agregar el talle al nombre
      if (PRODUCTS_WITH_SIZE.includes(match)) {
        // Primero intentar desde variant_values, sino extraer del nombre entre paréntesis
        const size = (variantValues && variantValues[0])
          || (rawName.match(/\((\w+)\)\s*$/) || [])[1];
        if (size) return `${internal} ${size}`;
      }
      return internal;
    }
  }
  return rawName;
}

const PRODUCT_ORDER = ['Gorro', 'Rodillera', 'Tobillera', 'Codera', 'Medias Spa'];

function findCombo(totalKg, products, tolerance = 0.016) {
  function* combosWithRep(arr, n) {
    if (n === 0) { yield []; return; }
    for (let i = 0; i < arr.length; i++) {
      for (const rest of combosWithRep(arr.slice(i), n - 1)) {
        yield [arr[i], ...rest];
      }
    }
  }
  for (let n = 1; n <= 6; n++) {
    for (const combo of combosWithRep(products, n)) {
      const sum = combo.reduce((s, p) => s + p.weight, 0);
      if (Math.abs(sum - totalKg) <= tolerance) {
        const result = {};
        for (const p of combo) result[p.name] = (result[p.name] || 0) + 1;
        return result;
      }
    }
  }
  return null;
}

function comboSortKey(combo, sortOrder) {
  if (!combo) return '99';
  // Generar una clave de sort basada en el orden personalizado
  // Para cada producto en el combo, buscar su posición en sortOrder
  // Esto agrupa primero por el producto de mayor prioridad
  const order = sortOrder || PRODUCT_ORDER;
  const parts = [];
  for (const prod of order) {
    if (combo[prod]) parts.push(String(order.indexOf(prod)).padStart(2, '0') + '-' + String(combo[prod]).padStart(2, '0'));
  }
  // Productos no listados van al final
  for (const prod of Object.keys(combo)) {
    if (!order.includes(prod)) parts.push('99-' + String(combo[prod]).padStart(2, '0'));
  }
  return parts.length ? parts.join('|') : '99';
}

async function getPageItems(page) {
  const content = await page.getTextContent();
  return content.items.map(item => ({
    str: item.str,
    x: item.transform[4],
    y: item.transform[5],
  }));
}

// Detecta el formato de la etiqueta para mostrar en el resumen
async function detectFormat(pdfDoc) {
  const page = await pdfDoc.getPage(1);
  const items = await getPageItems(page);
  const allText = items.map(i => i.str).join(' ').toLowerCase();
  if (allText.includes('e-pick') || allText.includes('epick') || allText.includes('logistica que impulsa')) return 'E-Pick';
  if (allText.includes('cabify')) return 'Cabify';
  if (allText.includes('correo argentino') || allText.includes('correoargentino')) return 'Correo Argentino';
  if (allText.includes('andreani')) return 'Andreani';
  if (allText.includes('oca')) return 'OCA';
  if (allText.includes('mercado envíos') || allText.includes('mercado envios') || allText.includes('mercadoenvios')) return 'Mercado Envíos';
  return 'Otro';
}

// Extrae el número de orden de una página probando múltiples patrones
function extractOrderNumber(items) {
  // Primero: buscar en el texto completo de la página (maneja items separados)
  const fullText = items.map(i => i.str).join(' ');

  // Patrones sobre el texto completo (más confiables)
  const fullTextPatterns = [
    /[Oo]rden\s*[#:.]?\s*(\d{4,6})(?:-\d+)?/,
    /[Pp]edido\s*#?\s*(\d{4,6})(?:-\d+)?/,
    /[Oo]rder\s*#?\s*(\d{4,6})(?:-\d+)?/,
    /[Nn]ro\.?\s*[:.]?\s*(\d{4,6})(?:-\d+)?/,
  ];
  for (const regex of fullTextPatterns) {
    const match = fullText.match(regex);
    if (match) return match[1];
  }

  // Segundo: buscar en items individuales
  const itemPatterns = [
    // #12345 (E-Pick, común)
    { regex: /^#(\d{4,6})$/, extract: m => m[1] },
    // "Orden #12345" o "Orden: 12345" dentro de un solo item
    { regex: /(?:pedido|orden|order)\s*[#:.]?\s*(\d{4,6})(?:-\d+)?/i, extract: m => m[1] },
    // Cabify: "14884-1" formato (número-sufijo)
    { regex: /^(\d{4,6})-\d+$/, extract: m => m[1] },
    // Número suelto con # adelante
    { regex: /^#(\d{4,6})$/, extract: m => m[1] },
  ];

  for (const { regex, extract, filter } of itemPatterns) {
    for (const item of items) {
      if (filter && !filter(item)) continue;
      const txt = item.str.trim();
      const match = txt.match(regex);
      if (match) return extract(match);
    }
  }

  return '';
}

// Parser universal: funciona con cualquier carrier
async function parseLabels(pdfDoc, products, credentials) {
  const rawLabels = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const items = await getPageItems(page);
    const orden = extractOrderNumber(items);

    // Extraer peso como fallback (formato "X.XXX Kg")
    let peso = 0;
    for (const item of items) {
      const txt = item.str.trim();
      const kgMatch = txt.match(/([\d.]+)\s*[Kk]g/);
      if (kgMatch) {
        const val = parseFloat(kgMatch[1]);
        if (val > 0 && val < 50) { peso = val; break; }
      }
    }

    rawLabels.push({ orden, peso, page: p });
  }

  // Fetchear productos desde TiendaNube API (en lotes para evitar rate-limit)
  const cache = new Map();
  const BATCH = 5;
  const combos = new Array(rawLabels.length).fill(null);

  for (let i = 0; i < rawLabels.length; i += BATCH) {
    const batch = rawLabels.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(({ orden }) => {
        if (!orden || !credentials) return Promise.resolve(null);
        if (!cache.has(orden)) cache.set(orden, fetchOrderFromTiendaNube(orden, credentials));
        return cache.get(orden);
      })
    );
    for (let j = 0; j < results.length; j++) combos[i + j] = results[j];
  }

  // Si la API no devolvió resultado, fallback a peso
  return rawLabels.map((l, i) => ({
    ...l,
    combo: combos[i] || (l.peso > 0 ? findCombo(l.peso, products) : null),
  }));
}

async function fetchOrderFromTiendaNube(ordenNumber, credentials, retries = 2) {
  const { storeId, token } = credentials;
  const url = `/api/tiendanube?orden=${encodeURIComponent(ordenNumber)}&storeId=${encodeURIComponent(storeId)}&token=${encodeURIComponent(token)}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt));
    const res = await fetch(url).catch(() => null);
    if (!res) continue;
    if (res.status === 429) continue; // rate-limited, retry
    if (!res.ok) return null;

    const orders = await res.json();
    if (!Array.isArray(orders)) return null;

    const order = orders.find(o => String(o.number) === String(ordenNumber));
    if (!order?.products?.length) return null;

    const combo = {};
    for (const item of order.products) {
      const name = mapTiendaNubeName(item.name || '', item.variant_values);
      combo[name] = (combo[name] || 0) + (item.quantity || 1);
    }
    return Object.keys(combo).length ? combo : null;
  }
  return null;
}

function getColor(name) {
  if (name.includes('Gorro'))      return { bg: rgb(0.88, 0.88, 0.99), text: rgb(0.21, 0.20, 0.54) };
  if (name.includes('Rodillera'))  return { bg: rgb(0.85, 0.96, 0.90), text: rgb(0.03, 0.31, 0.25) };
  if (name.includes('Tobillera'))  return { bg: rgb(0.98, 0.93, 0.85), text: rgb(0.39, 0.22, 0.02) };
  if (name.includes('Codera'))     return { bg: rgb(0.98, 0.90, 0.95), text: rgb(0.55, 0.10, 0.35) };
  return { bg: rgb(0.94, 0.94, 0.94), text: rgb(0.33, 0.33, 0.33) };
}

async function drawStripAtY(page, combo, stripY, stripH, aliases = {}) {
  const { width } = page.getSize();
  // Escalar fuentes y padding según tamaño de tira
  const scale = stripH / 38; // 38 = tamaño "normal" de referencia
  const padX = Math.round(8 * scale);
  const titleSize = Math.max(4, Math.round(6 * scale));
  const tagFontSize = Math.max(6, Math.round(9 * scale));
  const tagH = Math.max(11, Math.round(17 * scale));

  page.drawRectangle({
    x: 10, y: stripY, width: width - 20, height: stripH,
    color: rgb(0.97, 0.97, 1.0),
    borderColor: rgb(0.78, 0.78, 0.92),
    borderWidth: 0.6,
  });
  const doc = page.doc;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText('CONTENIDO DEL PAQUETE', {
    x: 14, y: stripY + stripH - titleSize - 4,
    size: titleSize, font, color: rgb(0.4, 0.4, 0.55),
  });
  if (!combo) {
    page.drawText('No se pudo determinar', {
      x: 14, y: stripY + stripH / 2 - 4, size: Math.round(8 * scale), font, color: rgb(0.7, 0.4, 0.1),
    });
    return;
  }
  let xPos = 14;
  const tagY = stripY + Math.max(3, Math.round(7 * scale));
  for (const [prod, qty] of Object.entries(combo)) {
    if (aliases[prod] === '') continue;
    const displayName = aliases[prod] || prod;
    const label = qty > 1 ? `${qty}x ${displayName}` : displayName;
    const tw = bold.widthOfTextAtSize(label, tagFontSize);
    const tagW = tw + padX * 2;
    const { bg, text } = getColor(prod);
    page.drawRectangle({
      x: xPos, y: tagY, width: tagW, height: tagH,
      color: bg,
      borderColor: rgb(bg.red * 0.8, bg.green * 0.8, bg.blue * 0.8),
      borderWidth: 0.3,
    });
    page.drawText(label, {
      x: xPos + padX, y: tagY + Math.round(4.5 * scale),
      size: tagFontSize, font: bold, color: text,
    });
    xPos += tagW + Math.round(5 * scale);
  }
}

// Fase 1: Analizar — lee PDF, extrae órdenes, busca productos en API
export async function analyzePDF(arrayBuffer, products = DEFAULT_PRODUCTS, credentials = null) {
  const buffer = arrayBuffer.slice(0);
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdfDoc = await loadingTask.promise;

  const format = await detectFormat(pdfDoc);
  const labels = await parseLabels(pdfDoc, products, credentials);

  // Calcular resumen
  const combos = labels.map(l => l.combo).filter(Boolean);
  const totals = {};
  const comboMap = {};

  for (const combo of combos) {
    for (const [prod, qty] of Object.entries(combo)) {
      totals[prod] = (totals[prod] || 0) + qty;
    }
    const key = Object.entries(combo).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([n, q]) => q > 1 ? `${q}x ${n}` : n).join(' + ');
    comboMap[key] = (comboMap[key] || 0) + 1;
  }

  const sortedTotals = {};
  for (const p of PRODUCT_ORDER) {
    if (totals[p]) sortedTotals[p] = totals[p];
  }
  for (const p of Object.keys(totals)) {
    if (!sortedTotals[p]) sortedTotals[p] = totals[p];
  }

  // Lista de combinaciones únicas (para reordenar)
  const comboList = Object.entries(comboMap)
    .sort((a, b) => b[1] - a[1])
    .map(([desc, count]) => ({ desc, count }));

  return {
    labels,
    resumen: {
      formato: format,
      total_paquetes: labels.length,
      total_productos: Object.values(totals).reduce((s, v) => s + v, 0),
      por_producto: sortedTotals,
      combinaciones: comboList,
      no_resueltos: labels.filter(l => !l.combo).length,
    }
  };
}

// Fase 2: Generar PDF — toma labels ya analizados + configuración del usuario
export async function generatePDF(arrayBuffer, labels, comboOrder = null, aliases = {}, stripSize = 'normal', stripPct = null) {
  const buffer = arrayBuffer.slice(0);
  let sortedLabels = [...labels];

  if (comboOrder && comboOrder.length > 0) {
    // Ordenar labels según el orden de combos definido por el usuario
    sortedLabels.sort((a, b) => {
      const keyA = comboKey(a.combo);
      const keyB = comboKey(b.combo);
      let idxA = comboOrder.indexOf(keyA);
      let idxB = comboOrder.indexOf(keyB);
      if (idxA === -1) idxA = 999;
      if (idxB === -1) idxB = 999;
      return idxA - idxB;
    });
  }

  const pdfLibDoc = await PDFDocument.load(buffer);
  const newDoc = await PDFDocument.create();

  const STRIP_SIZES = { chica: 24, normal: 38, grande: 52 };
  const STRIP_H = STRIP_SIZES[stripSize] || 38;
  const FOOTER_PAD = 6;
  const useFooter = stripPct === null || stripPct === undefined;

  for (const label of sortedLabels) {
    const pageIdx = (label.page || 1) - 1;

    if (useFooter) {
      // Modo Pie: embeber la página original en una página más grande
      const embedded = await newDoc.embedPage(pdfLibDoc.getPage(pageIdx));
      const { width, height } = embedded;
      const page = newDoc.addPage([width, height + STRIP_H]);
      // Dibujar la etiqueta original desplazada hacia arriba
      page.drawPage(embedded, { x: 0, y: STRIP_H, width, height });
      await drawStripAtY(page, label.combo, 0, STRIP_H, aliases);
    } else {
      // Modo Manual: dibujar sobre la etiqueta existente en la posición elegida
      const [copied] = await newDoc.copyPages(pdfLibDoc, [pageIdx]);
      const { width, height } = copied.getSize();
      newDoc.addPage(copied);
      const pages = newDoc.getPages();
      const page = pages[pages.length - 1];
      // stripPct: 0 = arriba, 1 = abajo (en coordenadas de pantalla)
      // En PDF Y=0 es abajo, así que invertimos
      const stripY = height - (stripPct * (height - STRIP_H)) - STRIP_H;
      await drawStripAtY(page, label.combo, Math.max(0, stripY), STRIP_H, aliases);
    }
  }

  return await newDoc.save();
}

// Genera la clave de una combinación (para matching con el orden del usuario)
function comboKey(combo) {
  if (!combo) return '__no_resuelto__';
  return Object.entries(combo).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([n, q]) => q > 1 ? `${q}x ${n}` : n).join(' + ');
}
