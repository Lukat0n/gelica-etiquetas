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

function comboSortKey(combo) {
  if (!combo) return [99, 99];
  for (let i = 0; i < PRODUCT_ORDER.length; i++) {
    if (combo[PRODUCT_ORDER[i]]) return [i, combo[PRODUCT_ORDER[i]]];
  }
  return [99, 99];
}

async function getPageItems(page) {
  const content = await page.getTextContent();
  return content.items.map(item => ({
    str: item.str,
    x: item.transform[4],
    y: item.transform[5],
  }));
}

async function detectFormat(pdfDoc) {
  const page = await pdfDoc.getPage(1);
  const items = await getPageItems(page);
  const allText = items.map(i => i.str).join(' ').toLowerCase();
  if (allText.includes('e-pick') || allText.includes('epick') ||
      allText.includes('logistica que impulsa') || allText.includes('e pick')) {
    return 'epick';
  }
  const hasHash = items.some(i => /^#\d{4,6}$/.test(i.str.trim()));
  if (hasHash) return 'epick';
  return 'cabify';
}

async function parseCabifyLabels(pdfDoc, products, credentials) {
  // Paso 1: extraer número de orden y peso de cada página
  const rawLabels = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const items = await getPageItems(page);
    let orden = '', peso = 0;
    for (const item of items) {
      const txt = item.str.trim();
      if (!txt) continue;
      if (item.x > 85 && item.x < 100 && item.y > 295 && item.y < 310) {
        orden = txt.replace(/-\d+$/, '').replace('#', '').trim();
      }
      if (item.x > 340 && item.y < 60 && txt.includes('Kg')) {
        try { peso = parseFloat(txt.replace(' Kg', '')); } catch {}
      }
    }
    rawLabels.push({ orden, peso, page: p });
  }

  // Paso 2: fetchear productos desde TiendaNube API (con cache)
  const cache = new Map();
  const combos = await Promise.all(
    rawLabels.map(({ orden }) => {
      if (!orden || !credentials) return Promise.resolve(null);
      if (!cache.has(orden)) cache.set(orden, fetchOrderFromTiendaNube(orden, credentials));
      return cache.get(orden);
    })
  );

  // Paso 3: si la API no devolvió resultado, fallback a peso
  return rawLabels.map((l, i) => ({
    ...l,
    combo: combos[i] || (l.peso > 0 ? findCombo(l.peso, products) : null),
  }));
}

async function fetchOrderFromTiendaNube(ordenNumber, credentials) {
  const { storeId, token } = credentials;
  const url = `/api/tiendanube?orden=${encodeURIComponent(ordenNumber)}&storeId=${encodeURIComponent(storeId)}&token=${encodeURIComponent(token)}`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return null;

  const orders = await res.json();
  if (!Array.isArray(orders)) return null;

  // TiendaNube q= hace búsqueda substring — buscar match exacto por número
  const order = orders.find(o => String(o.number) === String(ordenNumber));
  if (!order?.products?.length) return null;

  const combo = {};
  for (const item of order.products) {
    const name = mapTiendaNubeName(item.name || '', item.variant_values);
    combo[name] = (combo[name] || 0) + (item.quantity || 1);
  }
  return Object.keys(combo).length ? combo : null;
}

async function parseEpickLabels(pdfDoc, credentials) {
  // Paso 1: extraer número de orden de cada página
  const rawLabels = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const items = await getPageItems(page);
    let orden = '';
    for (const item of items) {
      const txt = item.str.trim();
      if (/^#\d{4,6}$/.test(txt)) orden = txt.replace('#', '');
    }
    rawLabels.push({ orden, page: p });
  }

  // Paso 2: fetchear todos los pedidos en paralelo con cache para evitar duplicados
  const cache = new Map();
  const combos = await Promise.all(
    rawLabels.map(({ orden }) => {
      if (!orden || !credentials) return Promise.resolve(null);
      if (!cache.has(orden)) cache.set(orden, fetchOrderFromTiendaNube(orden, credentials));
      return cache.get(orden);
    })
  );

  return rawLabels.map((l, i) => ({ ...l, combo: combos[i] }));
}

function getColor(name) {
  if (name.includes('Gorro'))      return { bg: rgb(0.88, 0.88, 0.99), text: rgb(0.21, 0.20, 0.54) };
  if (name.includes('Rodillera'))  return { bg: rgb(0.85, 0.96, 0.90), text: rgb(0.03, 0.31, 0.25) };
  if (name.includes('Tobillera'))  return { bg: rgb(0.98, 0.93, 0.85), text: rgb(0.39, 0.22, 0.02) };
  if (name.includes('Codera'))     return { bg: rgb(0.98, 0.90, 0.95), text: rgb(0.55, 0.10, 0.35) };
  return { bg: rgb(0.94, 0.94, 0.94), text: rgb(0.33, 0.33, 0.33) };
}

async function drawStrip(page, combo, stripPct = 0.95, aliases = {}) {
  const { width, height } = page.getSize();
  const stripH = 38, padX = 8;
  // stripPct: 0 = top, 1 = bottom. En PDF el Y=0 es abajo, así que invertimos.
  const stripY = (1 - stripPct) * (height - stripH);
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
    x: 14, y: stripY + stripH - 11,
    size: 6, font, color: rgb(0.4, 0.4, 0.55),
  });
  if (!combo) {
    page.drawText('No se pudo determinar', {
      x: 14, y: stripY + 13, size: 8, font, color: rgb(0.7, 0.4, 0.1),
    });
    return;
  }
  let xPos = 14;
  const tagY = stripY + 7, tagH = 17;
  for (const [prod, qty] of Object.entries(combo)) {
    // Si el alias es string vacío, ocultar este producto de la etiqueta
    if (aliases[prod] === '') continue;
    const displayName = aliases[prod] || prod;
    const label = qty > 1 ? `${qty}x ${displayName}` : displayName;
    const tw = bold.widthOfTextAtSize(label, 9);
    const tagW = tw + padX * 2;
    const { bg, text } = getColor(prod);
    page.drawRectangle({
      x: xPos, y: tagY, width: tagW, height: tagH,
      color: bg,
      borderColor: rgb(bg.red * 0.8, bg.green * 0.8, bg.blue * 0.8),
      borderWidth: 0.3,
    });
    page.drawText(label, {
      x: xPos + padX, y: tagY + 4.5,
      size: 9, font: bold, color: text,
    });
    xPos += tagW + 5;
  }
}

export async function processPDF(arrayBuffer, sortByProduct = false, products = DEFAULT_PRODUCTS, credentials = null, stripPct = 0.95, aliases = {}) {
  const buffer1 = arrayBuffer.slice(0);
  const buffer2 = arrayBuffer.slice(0);

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer1) });
  const pdfDoc = await loadingTask.promise;

  const format = await detectFormat(pdfDoc);

  let labels = format === 'epick'
    ? await parseEpickLabels(pdfDoc, credentials)
    : await parseCabifyLabels(pdfDoc, products, credentials);

  if (sortByProduct) {
    labels = [...labels].sort((a, b) => {
      const ka = comboSortKey(a.combo);
      const kb = comboSortKey(b.combo);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
  }

  const pdfLibDoc = await PDFDocument.load(buffer2);
  const newDoc = await PDFDocument.create();

  for (const label of labels) {
    const pageIdx = (label.page || 1) - 1;
    const [copied] = await newDoc.copyPages(pdfLibDoc, [pageIdx]);
    newDoc.addPage(copied);
    const pages = newDoc.getPages();
    await drawStrip(pages[pages.length - 1], label.combo, stripPct, aliases);
  }

  const pdfBytes = await newDoc.save();
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
  // Agregar productos desconocidos al final
  for (const p of Object.keys(totals)) {
    if (!sortedTotals[p]) sortedTotals[p] = totals[p];
  }

  return {
    pdfBytes,
    resumen: {
      formato: format === 'epick' ? 'E-Pick' : 'Cabify',
      total_paquetes: labels.length,
      total_productos: Object.values(totals).reduce((s, v) => s + v, 0),
      por_producto: sortedTotals,
      combinaciones: Object.entries(comboMap).sort((a, b) => b[1] - a[1]).map(([desc, count]) => ({ desc, count })),
      no_resueltos: labels.filter(l => !l.combo).length,
    }
  };
}
