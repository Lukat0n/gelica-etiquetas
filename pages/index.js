import { useState, useRef, useCallback, useEffect } from 'react';
import Head from 'next/head';
import { analyzePDF, generatePDF, DEFAULT_PRODUCTS } from '../lib/pdfProcessor';

export default function Home() {
  const [file, setFile] = useState(null);
  const [arrayBuffer, setArrayBuffer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [labels, setLabels] = useState(null);
  const [pdfBlob, setPdfBlob] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [credsSaved, setCredsSaved] = useState(false);
  const [aliases, setAliases] = useState({});
  const [comboOrder, setComboOrder] = useState([]);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [stripSize, setStripSize] = useState('normal');
  const inputRef = useRef();

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
  }, []);

  const saveCredentials = () => {
    localStorage.setItem('tn_store_id',  storeId.trim());
    localStorage.setItem('tn_api_token', apiToken.trim());
    setCredsSaved(true);
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
      setLabels(null);
      setPdfBlob(null);
      setComboOrder([]);
      setArrayBuffer(null);
    }
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    handleFile(f);
  }, []);

  // Fase 1: Analizar PDF
  const analizar = async () => {
    if (!file) return;
    setLoading(true);
    setResultado(null);
    setLabels(null);
    setPdfBlob(null);
    try {
      const buf = await file.arrayBuffer();
      setArrayBuffer(buf);
      const credentials = storeId && apiToken
        ? { storeId: storeId.trim(), token: apiToken.trim() }
        : null;
      const { labels: parsedLabels, resumen } = await analyzePDF(buf, DEFAULT_PRODUCTS, credentials);
      setLabels(parsedLabels);
      setResultado(resumen);
      // Inicializar orden de combos con el orden por defecto (por cantidad desc)
      setComboOrder(resumen.combinaciones.map(c => c.desc));
    } catch (e) {
      alert('Error analizando el PDF: ' + e.message);
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Fase 2: Generar PDF final
  const generar = async () => {
    if (!labels || !arrayBuffer) return;
    setGenerating(true);
    setPdfBlob(null);
    try {
      const pdfBytes = await generatePDF(arrayBuffer, labels, comboOrder, aliases, stripSize);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      setPdfBlob(blob);
    } catch (e) {
      alert('Error generando el PDF: ' + e.message);
      console.error(e);
    } finally {
      setGenerating(false);
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

  const moveCombo = (index, direction) => {
    const newOrder = [...comboOrder];
    const target = index + direction;
    if (target < 0 || target >= newOrder.length) return;
    [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
    setComboOrder(newOrder);
    setPdfBlob(null);
  };

  const handleDragStart = (idx) => {
    setDragIdx(idx);
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  };

  const handleDragEnd = () => {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      const newOrder = [...comboOrder];
      const [moved] = newOrder.splice(dragIdx, 1);
      newOrder.splice(dragOverIdx, 0, moved);
      setComboOrder(newOrder);
      setPdfBlob(null);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const tagClass = (prod) => {
    if (prod.includes('Gorro')) return styles.tagGorro;
    if (prod.includes('Rodillera')) return styles.tagRod;
    if (prod.includes('Tobillera')) return styles.tagTob;
    if (prod.includes('Codera')) return styles.tagCod;
    return styles.tagOther;
  };

  // Parsea "2x Rodillera M + Tobillera" → [{ label: '2x Rodillera M', prod: 'Rodillera M' }, { label: 'Tobillera', prod: 'Tobillera' }]
  const parseComboDesc = (desc) => {
    return desc.split(' + ').map(part => {
      const m = part.match(/^(\d+x\s+)?(.+)$/);
      return { label: part, prod: m ? m[2].trim() : part };
    });
  };

  // Productos únicos encontrados en el análisis
  const productosEncontrados = resultado ? Object.keys(resultado.por_producto) : [];

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

          {/* Paso 1: Subir PDF */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>1. Subí el PDF de etiquetas</h2>
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
                  <p style={styles.dropTitle}>Arrastrá o hacé click</p>
                  <p style={styles.dropSub}>Cabify, E-Pick, Correo Argentino, Andreani, etc.</p>
                </>
              )}
            </div>

            {file && !resultado && (
              <button
                style={{ ...styles.btnPrimary, marginTop: 16, ...(!file || loading ? styles.btnDisabled : {}) }}
                onClick={analizar}
                disabled={!file || loading}
              >
                {loading ? 'Analizando...' : 'Analizar PDF'}
              </button>
            )}

            {loading && (
              <div style={styles.loadingBar}>
                <div style={styles.loadingInner} />
              </div>
            )}
          </div>

          {/* Paso 2: Resumen + Configuración */}
          {resultado && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>2. Revisá el contenido</h2>

              <div style={styles.formatBadge}>
                {resultado.formato} · {resultado.total_paquetes} paquetes · {resultado.total_productos} productos
              </div>

              {resultado.no_resueltos > 0 && (
                <div style={styles.warn}>
                  {resultado.no_resueltos} etiqueta(s) no se pudieron identificar (orden no encontrada o credenciales no configuradas).
                </div>
              )}

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
                  <p style={styles.sectionTitle}>Nombres en etiqueta</p>
                  <p style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>Dejá vacío para ocultar</p>
                  {productosEncontrados.map(prod => (
                    <div key={prod} style={{ ...styles.listItem, gap: 8 }}>
                      <span style={{ ...styles.tag, ...tagClass(prod), fontSize: 11 }}>{prod}</span>
                      <input
                        style={styles.aliasInput}
                        type="text"
                        placeholder={prod}
                        value={aliases[prod] !== undefined ? aliases[prod] : ''}
                        onChange={e => updateAlias(prod, e.target.value)}
                      />
                      {aliases[prod] === '' && <span style={styles.aliasHidden}>oculto</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Paso 3: Ordenar combinaciones */}
          {resultado && comboOrder.length > 0 && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>3. Ordená las agrupaciones</h2>
              <p style={styles.helpText}>Arrastrá las filas o usá las flechas para reordenar. Así se agrupan en el PDF final.</p>

              <div style={styles.sortList}>
                {comboOrder.map((desc, i) => {
                  const count = resultado.combinaciones.find(c => c.desc === desc)?.count || 0;
                  const parts = parseComboDesc(desc);
                  const isDragging = dragIdx === i;
                  const isOver = dragOverIdx === i && dragIdx !== i;
                  return (
                    <div
                      key={desc}
                      draggable
                      onDragStart={() => handleDragStart(i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDragEnd={handleDragEnd}
                      style={{
                        ...styles.sortRow,
                        ...(isDragging ? styles.sortRowDragging : {}),
                        ...(isOver ? styles.sortRowOver : {}),
                      }}
                    >
                      <span style={styles.dragHandle}>⠿</span>
                      <span style={styles.sortNum}>{i + 1}</span>
                      <div style={styles.comboTags}>
                        {parts.map((p, j) => (
                          <span key={j} style={{ ...styles.comboTag, ...tagClass(p.prod) }}>{p.label}</span>
                        ))}
                      </div>
                      <span style={styles.badge}>x{count}</span>
                      <button style={styles.sortBtn} onClick={() => moveCombo(i, -1)} disabled={i === 0}>&#9650;</button>
                      <button style={styles.sortBtn} onClick={() => moveCombo(i, 1)} disabled={i === comboOrder.length - 1}>&#9660;</button>
                    </div>
                  );
                })}
                {resultado.no_resueltos > 0 && (
                  <div style={styles.sortRow}>
                    <span style={{ width: 20 }} />
                    <span style={styles.sortNum}>-</span>
                    <div style={{ ...styles.comboTags, flex: 1 }}>
                      <span style={{ fontSize: 13, color: '#999', fontStyle: 'italic' }}>No identificados</span>
                    </div>
                    <span style={styles.badge}>x{resultado.no_resueltos}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Paso 4: Generar */}
          {resultado && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>4. Generá el PDF</h2>
              <p style={styles.helpText}>La tira con el contenido se agrega como pie en cada etiqueta, sin tapar nada.</p>

              <div style={{ marginBottom: 18 }}>
                <p style={styles.optLabel}>Tamaño de la tira de productos</p>
                <div style={styles.sizeSelector}>
                  {[
                    { key: 'chica', label: 'Chica' },
                    { key: 'normal', label: 'Normal' },
                    { key: 'grande', label: 'Grande' },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      style={{
                        ...styles.sizeBtn,
                        ...(stripSize === opt.key ? styles.sizeBtnActive : {}),
                      }}
                      onClick={() => { setStripSize(opt.key); setPdfBlob(null); }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                style={{ ...styles.btnGenerar, ...(generating ? styles.btnDisabled : {}) }}
                onClick={generar}
                disabled={generating}
              >
                {generating ? 'Generando...' : 'Generar PDF'}
              </button>

              {generating && (
                <div style={styles.loadingBar}>
                  <div style={styles.loadingInner} />
                </div>
              )}

              {pdfBlob && (
                <button style={styles.btnDownload} onClick={descargar}>
                  Descargar PDF con productos
                </button>
              )}
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
  optLabel: { fontSize: 12, color: '#888', marginBottom: 6 },
  btnPrimary: { background: '#1a1a1a', color: '#fff', border: 'none', padding: '11px 28px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  loadingBar: { height: 3, background: '#f0f0f0', borderRadius: 2, marginTop: 16, overflow: 'hidden' },
  loadingInner: { height: '100%', background: '#1a1a1a', borderRadius: 2, animation: 'loading 1.5s ease-in-out infinite', width: '40%' },
  formatBadge: { background: '#f5f5f5', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#555', marginBottom: 20, display: 'inline-block' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 },
  sectionTitle: { fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 },
  listItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f5f5f5' },
  badge: { background: '#f0f0f0', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 500, color: '#555', whiteSpace: 'nowrap' },
  comboDesc: { fontSize: 13, color: '#333' },
  comboDesc2: { fontSize: 13, color: '#333', flex: 1 },
  tag: { display: 'inline-block', padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 500 },
  tagGorro: { background: '#eeedfe', color: '#3c3489' },
  tagRod: { background: '#e1f5ee', color: '#085041' },
  tagTob: { background: '#faeeda', color: '#633806' },
  tagCod: { background: '#fce8f3', color: '#7a1040' },
  tagOther: { background: '#f0f0f0', color: '#555' },
  warn: { background: '#fff8e6', border: '1px solid #f0c060', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#7a5500', marginBottom: 16 },
  btnGenerar: { display: 'block', width: '100%', background: '#1a1a1a', color: '#fff', border: 'none', padding: 14, borderRadius: 8, fontSize: 15, fontWeight: 500, cursor: 'pointer', textAlign: 'center' },
  btnDownload: { display: 'block', width: '100%', background: '#22a066', color: '#fff', border: 'none', padding: 14, borderRadius: 8, fontSize: 15, fontWeight: 500, cursor: 'pointer', textAlign: 'center', marginTop: 12 },
  aliasInput: { width: 80, border: '1px solid #e0e0e0', borderRadius: 6, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' },
  aliasHidden: { fontSize: 11, color: '#cc4444', fontStyle: 'italic' },
  sortList: { display: 'flex', flexDirection: 'column', gap: 2 },
  sortRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid transparent', background: '#fafafa', cursor: 'grab', transition: 'all 0.15s', userSelect: 'none' },
  sortRowDragging: { opacity: 0.4, background: '#f0f0ff' },
  sortRowOver: { borderColor: '#6060dd', background: '#f5f5ff' },
  sortNum: { fontSize: 11, color: '#aaa', fontWeight: 600, width: 18, textAlign: 'center', flexShrink: 0 },
  dragHandle: { fontSize: 14, color: '#bbb', cursor: 'grab', flexShrink: 0, lineHeight: 1 },
  comboTags: { display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, alignItems: 'center' },
  comboTag: { display: 'inline-block', padding: '3px 10px', borderRadius: 5, fontSize: 12, fontWeight: 600 },
  sortBtn: { background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 4, width: 28, height: 24, cursor: 'pointer', fontSize: 10, color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sizeSelector: { display: 'flex', gap: 6 },
  sizeBtn: { background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 6, padding: '7px 18px', fontSize: 13, cursor: 'pointer', color: '#555', fontFamily: 'inherit' },
  sizeBtnActive: { background: '#1a1a1a', color: '#fff', borderColor: '#1a1a1a' },
};
