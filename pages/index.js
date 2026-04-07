import { useState, useRef, useCallback, useEffect } from 'react';
import Head from 'next/head';
import { processPDF, DEFAULT_PRODUCTS } from '../lib/pdfProcessor';

export default function Home() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [ordenar, setOrdenar] = useState(false);
  const [pdfBlob, setPdfBlob] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [stripPct, setStripPct] = useState(0.95); // 0 = arriba, 1 = abajo (default: casi abajo)
  const previewRef = useRef();
  const [storeId, setStoreId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [credsSaved, setCredsSaved] = useState(false);
  const [aliases, setAliases] = useState({});
  const [sortOrder, setSortOrder] = useState(null);
  const inputRef = useRef();

  // Todos los productos con talles que pueden aparecer
  const ALL_PRODUCTS = [
    'Gorro', 'Rodillera S', 'Rodillera M', 'Rodillera L', 'Rodillera XL',
    'Tobillera', 'Codera S', 'Codera M', 'Codera L',
    'Medias Spa', 'Taloneras', 'Handgrip', 'Guantes', 'Faja Lumbar',
  ];

  const DEFAULT_SORT_ORDER = [...ALL_PRODUCTS];

  useEffect(() => {
    const id    = localStorage.getItem('tn_store_id')  || '';
    const token = localStorage.getItem('tn_api_token') || '';
    setStoreId(id);
    setApiToken(token);
    if (id && token) setCredsSaved(true);
    try {
      const saved = JSON.parse(localStorage.getItem('tn_aliases') || '{}');
      if (Object.keys(saved).length) setAliases(saved);
    } catch {}
    try {
      const savedOrder = JSON.parse(localStorage.getItem('tn_sort_order'));
      if (Array.isArray(savedOrder) && savedOrder.length) setSortOrder(savedOrder);
    } catch {}
  }, []);

  const saveCredentials = () => {
    localStorage.setItem('tn_store_id',  storeId.trim());
    localStorage.setItem('tn_api_token', apiToken.trim());
    setCredsSaved(true);
  };

  const currentSortOrder = sortOrder || DEFAULT_SORT_ORDER;

  const moveSortItem = (index, direction) => {
    const newOrder = [...currentSortOrder];
    const target = index + direction;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    setSortOrder(newOrder);
    localStorage.setItem('tn_sort_order', JSON.stringify(newOrder));
  };

  const updateAlias = (product, value) => {
    const next = { ...aliases, [product]: value };
    setAliases(next);
    localStorage.setItem('tn_aliases', JSON.stringify(next));
  };

  const handleFile = (f) => {
    if (f && f.type === 'application/pdf') {
      setFile(f);
      setResultado(null);
      setPdfBlob(null);
    }
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    handleFile(f);
  }, []);

  const procesar = async () => {
    if (!file) return;
    setLoading(true);
    setResultado(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const credentials = storeId && apiToken
        ? { storeId: storeId.trim(), token: apiToken.trim() }
        : null;
      const { pdfBytes, resumen } = await processPDF(arrayBuffer, ordenar, DEFAULT_PRODUCTS, credentials, stripPct, aliases, currentSortOrder);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      setPdfBlob(blob);
      setResultado(resumen);
    } catch (e) {
      alert('Error procesando el PDF: ' + e.message);
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const descargar = () => {
    if (!pdfBlob) return;
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'etiquetas_con_productos.pdf';
    a.click();
    URL.revokeObjectURL(url);
  };

  const tagClass = (prod) => {
    if (prod.includes('Gorro')) return styles.tagGorro;
    if (prod.includes('Rodillera')) return styles.tagRod;
    if (prod.includes('Tobillera')) return styles.tagTob;
    if (prod.includes('Codera')) return styles.tagCod;
    return styles.tagOther;
  };

  return (
    <>
      <Head>
        <title>Gélica — Etiquetas</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={styles.page}>
        <div style={styles.header}>
          <span style={styles.logo}>gélica</span>
          <span style={styles.subtitle}>procesador de etiquetas</span>
        </div>

        <div style={styles.container}>
          {/* Credenciales TiendaNube */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Credenciales TiendaNube</h2>
            <p style={styles.helpText}>Necesario para buscar los productos de cada orden. Se guardan en tu navegador.</p>
            <div style={styles.credsGrid}>
              <div>
                <p style={styles.optLabel}>ID de Tienda</p>
                <input
                  style={styles.input}
                  type="text"
                  placeholder="Ej: 123456"
                  value={storeId}
                  onChange={e => { setStoreId(e.target.value); setCredsSaved(false); }}
                />
              </div>
              <div>
                <p style={styles.optLabel}>API Token</p>
                <input
                  style={styles.input}
                  type="password"
                  placeholder="Token de acceso"
                  value={apiToken}
                  onChange={e => { setApiToken(e.target.value); setCredsSaved(false); }}
                />
              </div>
            </div>
            <div style={styles.credsFooter}>
              <button
                style={{ ...styles.btnSave, ...(credsSaved ? styles.btnSaved : {}) }}
                onClick={saveCredentials}
                disabled={!storeId || !apiToken}
              >
                {credsSaved ? '✓ Guardado' : 'Guardar'}
              </button>
              {credsSaved && <span style={styles.credsBadge}>Conectado a tienda #{storeId}</span>}
            </div>
          </div>

          {/* Aliases de productos */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Nombres en etiqueta</h2>
            <p style={styles.helpText}>Personalizá cómo aparece cada producto en la etiqueta. Dejá vacío para ocultarlo.</p>
            <div style={styles.aliasGrid}>
              {ALL_PRODUCTS.map(prod => (
                <div key={prod} style={styles.aliasRow}>
                  <span style={{ ...styles.tag, ...tagClass(prod), fontSize: 11 }}>{prod}</span>
                  <input
                    style={styles.aliasInput}
                    type="text"
                    placeholder={prod}
                    value={aliases[prod] !== undefined ? aliases[prod] : ''}
                    onChange={e => updateAlias(prod, e.target.value)}
                  />
                  {aliases[prod] !== undefined && aliases[prod] !== '' && (
                    <span style={styles.aliasPreview}>{aliases[prod]}</span>
                  )}
                  {aliases[prod] === '' && (
                    <span style={styles.aliasHidden}>oculto</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Orden de prioridad */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Orden de agrupación</h2>
            <p style={styles.helpText}>Cuando elegís "Por producto", las etiquetas se agrupan en este orden. Usá las flechas para reordenar.</p>
            <div style={styles.sortList}>
              {currentSortOrder.map((prod, i) => (
                <div key={prod} style={styles.sortRow}>
                  <span style={styles.sortNum}>{i + 1}</span>
                  <span style={{ ...styles.tag, ...tagClass(prod), fontSize: 11, flex: 1 }}>{prod}</span>
                  <button
                    style={styles.sortBtn}
                    onClick={() => moveSortItem(i, -1)}
                    disabled={i === 0}
                  >&#9650;</button>
                  <button
                    style={styles.sortBtn}
                    onClick={() => moveSortItem(i, 1)}
                    disabled={i === currentSortOrder.length - 1}
                  >&#9660;</button>
                </div>
              ))}
            </div>
          </div>

          {/* Upload */}
          <div style={styles.card}>
            <div
              style={{ ...styles.dropZone, ...(dragging ? styles.dropZoneActive : {}), ...(file ? styles.dropZoneDone : {}) }}
              onClick={() => inputRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
              <div style={styles.dropIcon}>{file ? '✓' : '📄'}</div>
              {file ? (
                <>
                  <p style={styles.dropTitle}>{file.name}</p>
                  <p style={styles.dropSub}>Click para cambiar</p>
                </>
              ) : (
                <>
                  <p style={styles.dropTitle}>Subí el PDF de etiquetas</p>
                  <p style={styles.dropSub}>Cabify, E-Pick, Correo Argentino, Andreani, etc. — arrastrá o hacé click</p>
                </>
              )}
            </div>

            <div style={styles.optionsRow}>
              <div>
                <p style={styles.optLabel}>Orden de etiquetas</p>
                <div style={styles.toggleGroup}>
                  <button style={{ ...styles.toggleBtn, ...(ordenar ? {} : styles.toggleActive) }} onClick={() => setOrdenar(false)}>Original</button>
                  <button style={{ ...styles.toggleBtn, ...(ordenar ? styles.toggleActive : {}) }} onClick={() => setOrdenar(true)}>Por producto</button>
                </div>
              </div>
              <button style={{ ...styles.btnPrimary, ...(!file || loading ? styles.btnDisabled : {}) }} onClick={procesar} disabled={!file || loading}>
                {loading ? 'Procesando...' : 'Generar PDF'}
              </button>
            </div>

            {/* Preview de etiqueta con drag */}
            <div style={{ marginTop: 20 }}>
              <p style={styles.optLabel}>Posición de la etiqueta — arrastrá la tira</p>
              <div
                ref={previewRef}
                style={styles.preview}
                onMouseMove={(e) => {
                  if (e.buttons !== 1) return;
                  const rect = previewRef.current.getBoundingClientRect();
                  const stripH = 32;
                  const y = e.clientY - rect.top;
                  const pct = Math.max(0, Math.min(1, (y) / (rect.height - stripH)));
                  setStripPct(pct);
                }}
                onTouchMove={(e) => {
                  const rect = previewRef.current.getBoundingClientRect();
                  const stripH = 32;
                  const y = e.touches[0].clientY - rect.top;
                  const pct = Math.max(0, Math.min(1, (y) / (rect.height - stripH)));
                  setStripPct(pct);
                }}
              >
                {/* Etiqueta mock */}
                <div style={styles.previewLabel}>
                  <div style={styles.mockHeader}>
                    <div style={styles.mockLine} />
                    <div style={{ ...styles.mockLine, width: '40%' }} />
                  </div>
                  <div style={styles.mockBarcode} />
                  <div style={styles.mockOrderRow}>
                    <span style={styles.mockOrderLabel}>Orden</span>
                    <span style={styles.mockOrderNum}>#999999</span>
                  </div>
                  <div style={styles.mockAddress}>
                    <div style={{ ...styles.mockLine, width: '75%' }} />
                    <div style={{ ...styles.mockLine, width: '55%' }} />
                    <div style={{ ...styles.mockLine, width: '65%' }} />
                  </div>

                  {/* Tira draggable */}
                  <div
                    style={{
                      ...styles.previewStrip,
                      top: `calc(${stripPct * 100}% - ${stripPct * 32}px)`,
                    }}
                  >
                    <span style={styles.previewStripTitle}>CONTENIDO DEL PAQUETE</span>
                    <div style={styles.previewStripTags}>
                      <span style={{ ...styles.previewTag, background: '#e1f5ee', color: '#085041' }}>
                        {aliases['Rodillera M'] !== undefined ? (aliases['Rodillera M'] || null) : 'Rodillera M'}
                      </span>
                      <span style={{ ...styles.previewTag, background: '#eeedfe', color: '#3c3489' }}>
                        {aliases['Gorro'] !== undefined ? (aliases['Gorro'] || null) : 'Gorro'}
                      </span>
                    </div>
                  </div>
                </div>
                <p style={styles.previewHint}>Click y arrastrá hacia arriba o abajo</p>
              </div>
            </div>

            {loading && (
              <div style={styles.loadingBar}>
                <div style={styles.loadingInner} />
              </div>
            )}
          </div>

          {/* Resultado */}
          {resultado && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Resumen del lote</h2>

              <div style={styles.formatBadge}>
                {resultado.formato} · {resultado.total_paquetes} paquetes · {resultado.total_productos} productos
              </div>

              <div style={styles.twoCol}>
                <div>
                  <p style={styles.sectionTitle}>Unidades por producto</p>
                  {Object.entries(resultado.por_producto).map(([prod, qty]) => (
                    <div key={prod} style={styles.listItem}>
                      <span style={{ ...styles.tag, ...tagClass(prod) }}>{prod}</span>
                      <span style={styles.badge}>{qty} uds.</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p style={styles.sectionTitle}>Combinaciones</p>
                  {resultado.combinaciones.map((c, i) => (
                    <div key={i} style={styles.listItem}>
                      <span style={styles.comboDesc}>{c.desc}</span>
                      <span style={styles.badge}>{c.count} paq.</span>
                    </div>
                  ))}
                </div>
              </div>

              {resultado.no_resueltos > 0 && (
                <div style={styles.warn}>⚠ {resultado.no_resueltos} etiqueta(s) no se pudieron identificar (orden no encontrada o credenciales no configuradas).</div>
              )}

              <button style={styles.btnDownload} onClick={descargar}>
                ⬇ Descargar PDF con productos
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f5f4f0', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  header: { background: '#fff', borderBottom: '1px solid #e5e5e5', padding: '18px 32px', display: 'flex', alignItems: 'center', gap: 12 },
  logo: { fontSize: 20, fontWeight: 700, letterSpacing: '-0.5px', color: '#1a1a1a' },
  subtitle: { fontSize: 13, color: '#999' },
  container: { maxWidth: 820, margin: '40px auto', padding: '0 20px' },
  card: { background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 28, marginBottom: 20 },
  cardTitle: { fontSize: 15, fontWeight: 600, marginBottom: 16, color: '#333' },
  helpText: { fontSize: 12, color: '#888', marginBottom: 14, marginTop: -8 },
  credsGrid: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 },
  input: { width: '100%', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' },
  credsFooter: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 },
  btnSave: { background: '#1a1a1a', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
  btnSaved: { background: '#22a066' },
  credsBadge: { fontSize: 12, color: '#22a066', fontWeight: 500 },
  dropZone: { border: '2px dashed #d0d0d0', borderRadius: 10, padding: '36px 20px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', background: '#fafafa' },
  dropZoneActive: { borderColor: '#6060dd', background: '#f0f0ff' },
  dropZoneDone: { borderColor: '#22a066', background: '#f0faf5' },
  dropIcon: { fontSize: 32, marginBottom: 8 },
  dropTitle: { fontSize: 15, fontWeight: 500, color: '#1a1a1a', margin: 0 },
  dropSub: { fontSize: 13, color: '#999', margin: '4px 0 0' },
  optionsRow: { display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: 20, flexWrap: 'wrap' },
  optLabel: { fontSize: 12, color: '#888', marginBottom: 6 },
  toggleGroup: { display: 'flex', background: '#f0f0f0', borderRadius: 8, padding: 3, gap: 3 },
  toggleBtn: { padding: '7px 16px', borderRadius: 6, border: 'none', fontSize: 13, cursor: 'pointer', background: 'transparent', color: '#666' },
  toggleActive: { background: '#fff', color: '#1a1a1a', fontWeight: 500, boxShadow: '0 1px 3px rgba(0,0,0,0.12)' },
  btnPrimary: { background: '#1a1a1a', color: '#fff', border: 'none', padding: '11px 28px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  loadingBar: { height: 3, background: '#f0f0f0', borderRadius: 2, marginTop: 16, overflow: 'hidden' },
  loadingInner: { height: '100%', background: '#1a1a1a', borderRadius: 2, animation: 'loading 1.5s ease-in-out infinite', width: '40%' },
  formatBadge: { background: '#f5f5f5', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#555', marginBottom: 20, display: 'inline-block' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 },
  sectionTitle: { fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 },
  listItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f5f5f5' },
  badge: { background: '#f0f0f0', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 500, color: '#555' },
  comboDesc: { fontSize: 13, color: '#333' },
  tag: { display: 'inline-block', padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 500 },
  tagGorro: { background: '#eeedfe', color: '#3c3489' },
  tagRod: { background: '#e1f5ee', color: '#085041' },
  tagTob: { background: '#faeeda', color: '#633806' },
  tagCod: { background: '#fce8f3', color: '#7a1040' },
  tagOther: { background: '#f0f0f0', color: '#555' },
  warn: { background: '#fff8e6', border: '1px solid #f0c060', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#7a5500', marginTop: 16 },
  btnDownload: { display: 'block', width: '100%', background: '#22a066', color: '#fff', border: 'none', padding: 14, borderRadius: 8, fontSize: 15, fontWeight: 500, cursor: 'pointer', textAlign: 'center', marginTop: 20 },
  preview: { userSelect: 'none', cursor: 'ns-resize', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  previewLabel: { position: 'relative', width: 220, height: 300, background: '#fff', border: '1px solid #d0d0d0', borderRadius: 6, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', overflow: 'hidden' },
  mockHeader: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 },
  mockLine: { height: 8, background: '#e8e8e8', borderRadius: 4, width: '60%' },
  mockBarcode: { height: 36, background: 'repeating-linear-gradient(90deg, #333 0px, #333 2px, #fff 2px, #fff 4px)', borderRadius: 3, marginBottom: 12, opacity: 0.3 },
  mockOrderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  mockOrderLabel: { fontSize: 10, color: '#aaa' },
  mockOrderNum: { fontSize: 14, fontWeight: 700, color: '#333' },
  mockAddress: { display: 'flex', flexDirection: 'column', gap: 5 },
  previewStrip: { position: 'absolute', left: 8, right: 8, height: 32, background: '#f5f5ff', border: '1px solid #c8c8e0', borderRadius: 5, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8px', pointerEvents: 'none', transition: 'top 0.05s ease-out' },
  previewStripTitle: { fontSize: 5, color: '#8888aa', marginBottom: 2 },
  previewStripTags: { display: 'flex', gap: 4 },
  previewTag: { fontSize: 8, fontWeight: 600, padding: '1px 6px', borderRadius: 3 },
  previewHint: { fontSize: 11, color: '#aaa', margin: 0 },
  aliasGrid: { display: 'flex', flexDirection: 'column', gap: 6 },
  aliasRow: { display: 'flex', alignItems: 'center', gap: 10 },
  aliasInput: { width: 100, border: '1px solid #e0e0e0', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' },
  aliasPreview: { fontSize: 11, color: '#22a066', fontWeight: 600 },
  aliasHidden: { fontSize: 11, color: '#cc4444', fontStyle: 'italic' },
  sortList: { display: 'flex', flexDirection: 'column', gap: 4 },
  sortRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' },
  sortNum: { fontSize: 11, color: '#aaa', fontWeight: 600, width: 18, textAlign: 'center' },
  sortBtn: { background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 4, width: 28, height: 24, cursor: 'pointer', fontSize: 10, color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center' },
};
