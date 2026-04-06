import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
}

// ── Productos ─────────────────────────────────────────────────────────────────
const PRODUCTS = [
  { name: 'Tobillera',   weight: 0.235 },
  { name: 'Codera',      weight: 0.280 },
  { name: 'Rodillera',   weight: 0.500 },
  { name: 'Gorro',       weight: 0.400 },
  { name: 'Medias Spa',  weight: 0.100 },
];

const PRODUCT_ORDER = ['Gorro', 'Rodillera', 'Tobillera', 'Codera', 'Medias Spa'];

function findCombo(totalKg, tolerance = 0.016) {
  function* combosWithRep(arr, n) {
    if (n === 0) { yield []; return; }
    for (let i = 0; i < arr.length; i++) {
      for (const rest of combosWithRep(arr.slice(i), n - 1)) {
        yield [arr[i], ...rest];
      }
    }
  }
  for (let n = 1; n <= 6; n++) {
    for (const combo of combosWithRep(PRODUCTS, n)) {
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

// ── Detect format ─────────────────────────────────────────────────────────────
async function detectFormat(pdfDoc) {
  try {
    const page = await pdfDoc.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map(i => i.str).join(' ');
    if (text.includes('Orden:') || text.includes('Zona:')) return 'cabify';
    if (text.includes('#') && (text.includes('Para:') || text.toUpperCase().includes('PICK'))) return 'epick';
    return 'cabify';
  } catch {
    return 'cabify';
  }
}

// ── Parse Cabify ──────────────────────────────────────────────────────────────
async function parseCabifyLabels(pdfDoc) {
  const labels = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items;

    let orden = '', peso = 0;
    for (const item of items) {
      const txt = item.str.trim();
      const tx = item.transform[4];
      const ty = item.transform[5];
      // Orden number: near x=89, y=301 in Cabify coords
      if (tx > 85 && tx < 95 && ty > 295 && ty < 310 && txt && !txt.includes('Orden')) {
        orden = txt.replace(/-\d+$/, '').replace('#', '').trim();
      }
      // Peso: right side, near bottom
      if (tx > 350 && ty < 60 && txt.includes('Kg')) {
        try { peso = parseFloat(txt.replace(' Kg', '')); } catch {}
      }
    }
    const combo = peso > 0 ? findCombo(peso) : null;
    labels.push({ orden, peso, combo, page: p });
  }
  return labels;
}

// ── Parse E-Pick ──────────────────────────────────────────────────────────────
async function parseEpickLabels(pdfDoc) {
  const labels = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items;

    let orden = '', peso = 0;
    for (const item of items) {
      const txt = item.str.trim();
      const tx = item.transform[4];
      const ty = item.transform[5];

      // Order: #XXXXX near specific position
      if (txt.startsWith('#') && tx > 60 && tx < 90) {
        orden = txt.replace('#', '').trim();
      }
      // Weight: the number in the circle, near x=195-215
      if (tx > 180 && tx < 220 && /^\d+\.\d+$/.test(txt)) {
        try { peso = parseFloat(txt); } catch {}
      }
    }
    const combo = peso > 0 ? findCombo(peso) : null;
    labels.push({ orden, peso, combo, page: p });
  }
  return labels;
}

// ── Colors ────────────────────────────────────────────────────────────────────
function getColor(name) {
  if (name.includes('Gorro'))      return { bg: rgb(0.88, 0.88, 0.99), text: rgb(0.21, 0.20, 0.54) };
  if (name.includes('Rodillera'))  return { bg: rgb(0.85, 0.96, 0.90), text: rgb(0.03, 0.31, 0.25) };
  if (name.includes('Tobillera'))  return { bg: rgb(0.98, 0.93, 0.85), text: rgb(0.39, 0.22, 0.02) };
  if (name.includes('Codera'))     return { bg: rgb(0.98, 0.90, 0.95), text: rgb(0.55, 0.10, 0.35) };
  return { bg: rgb(0.94, 0.94, 0.94), text: rgb(0.33, 0.33, 0.33) };
}

// ── Draw product strip onto a page ───────────────────────────────────────────
async function drawStrip(page, combo, font, boldFont, format) {
  const { width, height } = page.getSize();
  const stripH = format === 'epick' ? 38 : 32;
  const stripY = 8;
  const padX = 12;

  // Background
  page.drawRectangle({
    x: 10, y: stripY,
    width: width - 20, height: stripH,
    color: rgb(0.97, 0.97, 1.0),
    borderColor: rgb(0.78, 0.78, 0.92),
    borderWidth: 0.6,
    opacity: 1,
  });

  // Title
  page.drawText('CONTENIDO DEL PAQUETE', {
    x: 14, y: stripY + stripH - 10,
    size: 6, font, color: rgb(0.4, 0.4, 0.55),
  });

  if (!combo) {
    page.drawText('No se pudo determinar el contenido', {
      x: 14, y: stripY + 12,
      size: 8, font, color: rgb(0.7, 0.4, 0.1),
    });
    return;
  }

  let xPos = 14;
  const tagY = stripY + 6;
  const tagH = 16;
  const tagPad = 6;

  for (const [prod, qty] of Object.entries(combo)) {
    const label = qty > 1 ? `${qty}x ${prod}` : prod;
    const textW = boldFont.widthOfTextAtSize(label, 9);
    const tagW = textW + tagPad * 2;
    const { bg, text } = getColor(prod);

    page.drawRectangle({
      x: xPos, y: tagY,
      width: tagW, height: tagH,
      color: bg, borderColor: rgb(bg.red * 0.8, bg.green * 0.8, bg.blue * 0.8),
      borderWidth: 0.3,
    });

    page.drawText(label, {
      x: xPos + tagPad, y: tagY + 4,
      size: 9, font: boldFont, color: text,
    });

    xPos += tagW + 5;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function processPDF(arrayBuffer, sortByProduct = false) {
  // Copy buffer so both pdfjs and pdf-lib can use it independently
  const buffer1 = arrayBuffer.slice(0);
  const buffer2 = arrayBuffer.slice(0);

  // Load with pdfjs for text extraction
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer1) });
  const pdfDoc = await loadingTask.promise;

  const format = await detectFormat(pdfDoc);
  let labels = format === 'epick'
    ? await parseEpickLabels(pdfDoc)
    : await parseCabifyLabels(pdfDoc);

  if (sortByProduct) {
    labels = [...labels].sort((a, b) => {
      const ka = comboSortKey(a.combo);
      const kb = comboSortKey(b.combo);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
  }

  // Load with pdf-lib for modification
  const pdfLibDoc = await PDFDocument.load(buffer2);
  const font = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfLibDoc.embedFont(StandardFonts.HelveticaBold);

  // Rebuild pages in order
  const originalPages = pdfLibDoc.getPages();
  const newDoc = await PDFDocument.create();
  newDoc.embedFont(StandardFonts.Helvetica);

  for (const label of labels) {
    const pageIdx = (label.page || 1) - 1;
    const [copiedPage] = await newDoc.copyPages(pdfLibDoc, [pageIdx]);
    newDoc.addPage(copiedPage);

    const pages = newDoc.getPages();
    const page = pages[pages.length - 1];
    const nFont = await newDoc.embedFont(StandardFonts.Helvetica);
    const nBold = await newDoc.embedFont(StandardFonts.HelveticaBold);
    await drawStrip(page, label.combo, nFont, nBold, format);
  }

  const pdfBytes = await newDoc.save();

  // Build resumen
  const combos = labels.map(l => l.combo).filter(Boolean);
  const totals = {};
  const comboMap = {};

  for (const combo of combos) {
    for (const [prod, qty] of Object.entries(combo)) {
      totals[prod] = (totals[prod] || 0) + qty;
    }
    const key = Object.entries(combo).sort((a,b) => a[0].localeCompare(b[0]))
      .map(([n,q]) => q > 1 ? `${q}x ${n}` : n).join(' + ');
    comboMap[key] = (comboMap[key] || 0) + 1;
  }

  // Sort totals by product order
  const sortedTotals = {};
  for (const p of PRODUCT_ORDER) {
    if (totals[p]) sortedTotals[p] = totals[p];
  }

  const resumen = {
    formato: format === 'epick' ? 'E-Pick' : 'Cabify',
    total_paquetes: labels.length,
    total_productos: Object.values(totals).reduce((s, v) => s + v, 0),
    por_producto: sortedTotals,
    combinaciones: Object.entries(comboMap)
      .sort((a, b) => b[1] - a[1])
      .map(([desc, count]) => ({ desc, count })),
    no_resueltos: labels.filter(l => !l.combo).length,
  };

  return { pdfBytes, resumen };
}