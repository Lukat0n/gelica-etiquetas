# Gélica — Etiquetas

App web para procesar etiquetas de Cabify y E-Pick, agregar contenido del paquete y ordenar por producto.

## Setup local

```bash
npm install
npm run dev
```

Abrí http://localhost:3000

## Deploy en Vercel

1. Subí este repo a GitHub
2. Entrá a vercel.com → New Project
3. Importá el repo
4. Click Deploy — listo

## Actualizar pesos de productos

Editá `/lib/pdfProcessor.js`, línea ~10:

```js
const PRODUCTS = [
  { name: 'Tobillera',   weight: 0.235 },
  { name: 'Codera',      weight: 0.280 },
  { name: 'Rodillera',   weight: 0.500 },
  // Cuando tengas talles diferenciados:
  // { name: 'Rodillera S',  weight: 0.500 },
  // { name: 'Rodillera M',  weight: 0.510 },
  // { name: 'Rodillera L',  weight: 0.520 },
  // { name: 'Rodillera XL', weight: 0.530 },
  { name: 'Gorro',       weight: 0.400 },
  { name: 'Medias Spa',  weight: 0.100 },
];
```

Guardás, pusheás a GitHub, Vercel redeploya automático.
