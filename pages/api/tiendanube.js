export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { orden, storeId, token } = req.query;
  if (!orden || !storeId || !token) {
    return res.status(400).json({ error: 'Faltan parámetros: orden, storeId, token' });
  }

  const url = `https://api.tiendanube.com/v1/${storeId}/orders?q=${encodeURIComponent(orden)}&fields=number,products`;

  let r;
  try {
    r = await fetch(url, {
      headers: {
        'Authentication': `bearer ${token}`,
        'User-Agent': 'GelicaEtiquetas/1.0',
      },
    });
  } catch (err) {
    return res.status(502).json({ error: 'Error de red al contactar TiendaNube', detail: err.message });
  }

  if (!r.ok) {
    return res.status(r.status).json({ error: `TiendaNube retornó ${r.status}` });
  }

  const data = await r.json();
  return res.status(200).json(data);
}
