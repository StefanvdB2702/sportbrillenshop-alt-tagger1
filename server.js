// ============================================================
// Sportbrillenshop - Alt Tag + Bestandsnaam + Metavelden Updater
// Versie 11 - met barcode + custom.artikelnummer
// ============================================================

const express = require("express");
const crypto = require("crypto");
const app = express();

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// URL naar het Excel bestand op GitHub
const EXCEL_URL = "https://raw.githubusercontent.com/StefanvdB2702/sportbrillenshop-alt-tagger1/main/Goggles%202026.xlsx";

app.use(express.raw({ type: "application/json" }));

// ============================================================
// LICHTDOORLAATBAARHEID SKIBRILLEN
// Voeg hier later andere modellen toe
// ============================================================
const SKIBRIL_MODELLEN = [
  "fall line", "flight deck", "flight deck pro", "flight path",
  "flight tracker", "flow scape", "line miner", "line miner pro",
  "mont scape", "target line"
];

const LENS_DATA_SKIBRIL = {
  "sapphire":   { lichtdoorlaatbaarheid: "13%", categorie: "3" },
  "torch":      { lichtdoorlaatbaarheid: "17%", categorie: "2" },
  "clear":      { lichtdoorlaatbaarheid: "64%", categorie: "1" },
  "garnet":     { lichtdoorlaatbaarheid: "19%", categorie: "2" },
  "sage gold":  { lichtdoorlaatbaarheid: "14%", categorie: "3" },
  "rose gold":  { lichtdoorlaatbaarheid: "13%", categorie: "3" },
  "argon":      { lichtdoorlaatbaarheid: "14%", categorie: "3" },
  "persimmon":  { lichtdoorlaatbaarheid: "39%", categorie: "2" },
  "24k":        { lichtdoorlaatbaarheid: "12%", categorie: "3" },
  "iced":       { lichtdoorlaatbaarheid: "38%", categorie: "2" },
  "black":      { lichtdoorlaatbaarheid: "5.5%", categorie: "4" },
  "dark grey":  { lichtdoorlaatbaarheid: "11%", categorie: "3" },
  "hi pink":    { lichtdoorlaatbaarheid: "46%", categorie: "1" },
  // Voeg hier later andere modellen toe
};

// ============================================================
// TOKEN
// ============================================================
let cachedToken = null;
let tokenVerlooptOp = null;

async function haalToken() {
  if (cachedToken && tokenVerlooptOp && new Date() < tokenVerlooptOp) return cachedToken;
  console.log("🔑 Token ophalen...");
  const res = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Token mislukt: ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenVerlooptOp = new Date(Date.now() + 23 * 60 * 60 * 1000);
  console.log("✅ Token ontvangen!");
  return cachedToken;
}

// ============================================================
// HELPERS
// ============================================================
function maakNaam(titel) {
  return titel.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-]/g, "").replace(/-+/g, "-");
}

function isEchtShopify(body, sig) {
  if (!WEBHOOK_SECRET) return true;
  const verwacht = crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig || "", "base64"), Buffer.from(verwacht, "base64"));
  } catch { return false; }
}

async function graphql(query, variables, token) {
  const res = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) console.log("⚠️ GraphQL errors:", JSON.stringify(data.errors));
  return data;
}

// ============================================================
// CSV LEZEN
// Vertaal Shopify SKU (OO7149-07) naar Excel code (71490700)
// ============================================================
function vertaalSku(shopifySku) {
  // OO7149-07 → verwijder OO → 7149-07 → verwijder - → 714907 → voeg 00 toe → 71490700
  const zonder_oo = shopifySku.replace(/^OO/i, "");
  const delen = zonder_oo.split("-");
  if (delen.length !== 2) return null;
  const model = delen[0]; // 7149
  const kleur = delen[1].padStart(2, "0"); // 07
  return `${model}${kleur}00`; // 71490700
}

async function zoekInExcel(shopifySku) {
  try {
    const excelCode = vertaalSku(shopifySku);
    if (!excelCode) {
      console.log(`  ⚠️ SKU formaat niet herkend: ${shopifySku}`);
      return null;
    }

    console.log(`  🔍 Zoek Excel code: ${excelCode} (van SKU: ${shopifySku})`);

    const res = await fetch(EXCEL_URL);
    if (!res.ok) {
      console.log(`  ❌ Excel ophalen mislukt: ${res.status}`);
      return null;
    }

    const buffer = await res.arrayBuffer();
    const XLSX = require('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rijen = XLSX.utils.sheet_to_json(ws, { header: 1 });

    for (const rij of rijen) {
      // Kolom 10 (index 9) is de SKU kleurcode (bijv. 71490700)
      if (rij[9] && String(rij[9]).trim() === excelCode) {
        return {
          gtin: String(rij[0] || "").trim(),     // Kolom 1: GTIN
          framekleur: String(rij[14] || "").trim(), // Kolom 15: Framekleur
          lenskleur: String(rij[15] || "").trim(),  // Kolom 16: Lenskleur
        };
      }
    }

    console.log(`  ⚠️ SKU niet gevonden in Excel: ${excelCode}`);
    return null;
  } catch (fout) {
    console.log(`  ❌ Fout bij Excel lezen: ${fout.message}`);
    return null;
  }
}

// ============================================================
// METAVELDEN BEPALEN UIT PRODUCTTITEL + CSV
// ============================================================
function bepaalMetavelden(titel, csvData) {
  const titelLower = titel.toLowerCase();

  // Maat bepalen (XM = M, XL = L)
  let maat = "";
  if (/ xl\b| xm\b/.test(titelLower)) {
    maat = / xl\b/.test(titelLower) ? "L" : "M";
  } else if (/ l\b/.test(titelLower)) {
    maat = "L";
  } else if (/ m\b/.test(titelLower)) {
    maat = "M";
  } else if (/ s\b/.test(titelLower)) {
    maat = "S";
  }

  // Prizm bepalen
  const prizm = titelLower.includes("prizm") ? "ja" : "nee";

  // Transition bepalen
  const transition = (titelLower.includes("photochromic") || titelLower.includes("photochromatisch")) ? "ja" : "nee";

  // Gepolariseerd bepalen
  const polarized = titelLower.includes("polarized") ? "ja" : "nee";

  // Merk = eerste woord van de titel
  const merk = titel.split(" ")[0];

  // Lichtdoorlaatbaarheid + categorie bepalen
  let lichtdoorlaatbaarheid = "";
  let categorieLens = "";

  const isSkibril = SKIBRIL_MODELLEN.some(model => titelLower.includes(model));

  if (isSkibril && csvData?.lenskleur) {
    const lensLower = csvData.lenskleur.toLowerCase()
      .replace("prizm snow ", "")
      .replace("prizm ", "")
      .replace(" iridium", "")
      .trim();

    console.log(`  🔍 Lenskleur zoeken: "${lensLower}"`);

    for (const [sleutel, waarde] of Object.entries(LENS_DATA_SKIBRIL)) {
      if (lensLower.includes(sleutel)) {
        lichtdoorlaatbaarheid = waarde.lichtdoorlaatbaarheid;
        categorieLens = waarde.categorie;
        break;
      }
    }
  }

  return {
    "custom.size": maat,
    "custom.prizm": prizm,
    "custom.transition": transition,
    "custom.polarized": polarized,
    "custom.brand": merk,
    "custom.gender": "unisex",
    "custom.materiaal": lichtdoorlaatbaarheid,
    "custom.categorie_lens": categorieLens,
    "custom.gtin": csvData?.gtin || "",
  };
}

// ============================================================
// METAVELDEN OPHALEN UIT SHOPIFY
// ============================================================
async function haalMetaveldenOp(productId, token) {
  const data = await graphql(`
    query($id: ID!) {
      product(id: $id) {
        metafields(first: 20) {
          edges {
            node {
              namespace
              key
              value
            }
          }
        }
        variants(first: 1) {
          edges {
            node {
              id
              sku
            }
          }
        }
      }
    }
  `, { id: productId }, token);

  const metafields = {};
  const edges = data.data?.product?.metafields?.edges || [];
  for (const { node } of edges) {
    metafields[`${node.namespace}.${node.key}`] = node.value;
  }

  const sku = data.data?.product?.variants?.edges?.[0]?.node?.sku || "";
  const variantId = data.data?.product?.variants?.edges?.[0]?.node?.id || "";
  return { metafields, sku, variantId };
}

// ============================================================
// METAVELDEN INSTELLEN IN SHOPIFY
// ============================================================
async function stelMetaveldenIn(productId, metavelden, token) {
  const metafieldsInput = Object.entries(metavelden)
    .filter(([_, waarde]) => waarde !== "") // Lege waarden overslaan
    .map(([sleutel, waarde]) => {
      const [namespace, key] = sleutel.split(".");
      return {
        namespace,
        key,
        value: waarde,
        type: "single_line_text_field"
      };
    });

  if (metafieldsInput.length === 0) return;

  const data = await graphql(`
    mutation($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id }
        userErrors { field message }
      }
    }
  `, {
    input: {
      id: productId,
      metafields: metafieldsInput
    }
  }, token);

  const fouten = data.data?.productUpdate?.userErrors || [];
  if (fouten.length > 0) {
    console.log(`  ❌ Metavelden fout: ${fouten[0].message}`);
  } else {
    console.log(`  ✅ ${metafieldsInput.length} metavelden ingesteld`);
  }
}

// ============================================================
// BARCODE + ARTIKELNUMMER INSTELLEN
// ============================================================
async function stelBarcodeEnArtikelnummerIn(productId, variantId, sku, gtin, token) {
  // Stel custom.artikelnummer in als metaveld
  const metaveldData = await graphql(`
    mutation($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id }
        userErrors { field message }
      }
    }
  `, {
    input: {
      id: productId,
      metafields: [{
        namespace: "custom",
        key: "artikelnummer",
        value: sku,
        type: "single_line_text_field"
      }]
    }
  }, token);

  const metaveldFouten = metaveldData.data?.productUpdate?.userErrors || [];
  if (metaveldFouten.length > 0) {
    console.log(`  ❌ Artikelnummer fout: ${metaveldFouten[0].message}`);
  } else {
    console.log(`  ✅ custom.artikelnummer: "${sku}"`);
  }

  // Stel barcode (GTIN) in op de variant
  if (gtin && variantId) {
    const productGid = productId; // gid://shopify/Product/xxx
    const barcodeData = await graphql(`
      mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id barcode }
          userErrors { field message }
        }
      }
    `, {
      productId: productGid,
      variants: [{
        id: variantId,
        barcode: gtin
      }]
    }, token);

    const barcodeFouten = barcodeData.data?.productVariantsBulkUpdate?.userErrors || [];
    if (barcodeFouten.length > 0) {
      console.log(`  ❌ Barcode fout: ${barcodeFouten[0].message}`);
    } else {
      console.log(`  ✅ Barcode (GTIN): "${gtin}"`);
    }
  }
}

// ============================================================
// FOTO'S VERWERKEN
// ============================================================
async function haalFotos(productId, token) {
  const data = await graphql(`
    query($id: ID!) {
      product(id: $id) {
        title
        media(first: 50) {
          edges {
            node {
              id
              mediaContentType
              alt
              ... on MediaImage {
                mimeType
              }
            }
          }
        }
      }
    }
  `, { id: productId }, token);
  return data.data?.product;
}

async function pasAltAan(productId, mediaId, naam, token) {
  const data = await graphql(`
    mutation($productId: ID!, $media: [UpdateMediaInput!]!) {
      productUpdateMedia(productId: $productId, media: $media) {
        media { id alt }
        mediaUserErrors { field message }
      }
    }
  `, { productId, media: [{ id: mediaId, alt: naam }] }, token);
  const fouten = data.data?.productUpdateMedia?.mediaUserErrors || [];
  if (fouten.length > 0) { console.log(`  ❌ Alt tag fout: ${fouten[0].message}`); return false; }
  console.log(`  ✅ Alt tag: "${naam}"`);
  return true;
}

async function pasBestandsnaamAan(mediaId, naam, mimeType, token) {
  let ext = ".jpg";
  if (mimeType === "image/png") ext = ".png";
  else if (mimeType === "image/webp") ext = ".webp";
  else if (mimeType === "image/gif") ext = ".gif";
  const data = await graphql(`
    mutation($files: [FileUpdateInput!]!) {
      fileUpdate(files: $files) {
        files { id }
        userErrors { field message code }
      }
    }
  `, { files: [{ id: mediaId, filename: `${naam}${ext}` }] }, token);
  const fouten = data.data?.fileUpdate?.userErrors || [];
  if (fouten.length > 0) { console.log(`  ❌ Bestandsnaam fout: ${fouten[0].message}`); return false; }
  console.log(`  ✅ Bestandsnaam: "${naam}${ext}"`);
  return true;
}

// ============================================================
// HOOFDFUNCTIE
// ============================================================
async function verwerk(productData) {
  const productId = `gid://shopify/Product/${productData.id}`;
  const titel = productData.title;
  const naam = maakNaam(titel);

  console.log(`\n🛍️  Product: "${titel}"`);
  console.log(`📝 Naam wordt: "${naam}"`);

  const token = await haalToken();

  // Wacht 3 seconden zodat Shopify alles verwerkt heeft
  await new Promise(r => setTimeout(r, 3000));

  // Haal huidige SKU, variantId en metavelden op
  const { metafields: huidigeMetavelden, sku, variantId } = await haalMetaveldenOp(productId, token);
  console.log(`🏷️  SKU: "${sku || "nog niet ingevuld"}"`);

  // Metavelden alleen bijwerken als SKU ingevuld is EN veranderd is
  // We vergelijken de huidige SKU met custom.artikelnummer
  // Als ze verschillen → SKU is nieuw of gewijzigd → alles overschrijven
  const vorigeArtikelnummer = huidigeMetavelden["custom.artikelnummer"] || "";
  const skuIsGewijzigd = sku && sku.trim() !== "" && sku.trim() !== vorigeArtikelnummer.trim();

  console.log(`🔄 Vorige artikelnummer: "${vorigeArtikelnummer}" → Nieuw: "${sku}"`);
  console.log(`🔄 SKU gewijzigd: ${skuIsGewijzigd ? "ja" : "nee"}`);

  if (skuIsGewijzigd) {
    // Zoek product op in CSV
    const csvData = await zoekInExcel(sku);

    // Bepaal nieuwe metavelden
    const nieuweMetavelden = bepaalMetavelden(titel, csvData);

    console.log(`\n📋 Metavelden instellen:`);
    for (const [sleutel, waarde] of Object.entries(nieuweMetavelden)) {
      if (waarde) console.log(`  → ${sleutel}: "${waarde}"`);
    }

    await stelMetaveldenIn(productId, nieuweMetavelden, token);

    // Stel barcode (GTIN) en artikelnummer in
    await stelBarcodeEnArtikelnummerIn(productId, variantId, sku, csvData?.gtin, token);
  } else if (!sku || sku.trim() === "") {
    console.log(`ℹ️  Geen SKU — metavelden worden ingesteld zodra SKU wordt ingevoerd`);
  } else {
    console.log(`ℹ️  SKU ongewijzigd — metavelden worden niet overschreven`);
  }

  // Foto's verwerken
  const product = await haalFotos(productId, token);
  if (!product) { console.log("❌ Product niet gevonden"); return; }

  const fotos = product.media?.edges || [];
  console.log(`\n📸 ${fotos.length} foto('s) gevonden`);
  if (fotos.length === 0) { console.log("ℹ️  Geen foto's"); return; }

  let gelukt = 0;
  let overgeslagen = 0;

  for (const { node: foto } of fotos) {
    if (foto.mediaContentType !== "IMAGE") continue;
    console.log(`\n  🖼️  Foto: ${foto.id}`);
    console.log(`  📌 Huidige alt tag: "${foto.alt || "(leeg)"}"`);
    if (foto.alt && foto.alt.trim() !== "") {
      console.log(`  ⏭️  Overgeslagen — heeft al een alt tag`);
      overgeslagen++;
      continue;
    }
    await pasAltAan(productId, foto.id, naam, token);
    const bestandsnaam = gelukt === 0 ? naam : `${naam}-${gelukt + 1}`;
    await pasBestandsnaamAan(foto.id, bestandsnaam, foto.mimeType, token);
    gelukt++;
  }

  console.log(`\n🎉 Klaar! ${gelukt} foto('s) bijgewerkt, ${overgeslagen} overgeslagen voor "${titel}"`);
}

// ============================================================
// WEBHOOKS
// ============================================================
app.post("/webhook/product-created", async (req, res) => {
  if (!isEchtShopify(req.body, req.headers["x-shopify-hmac-sha256"])) return res.status(401).send("Ongeautoriseerd");
  res.status(200).send("Ontvangen!");
  try { await verwerk(JSON.parse(req.body.toString())); } catch (e) { console.error("❌ Fout:", e.message); }
});

app.post("/webhook/product-updated", async (req, res) => {
  if (!isEchtShopify(req.body, req.headers["x-shopify-hmac-sha256"])) return res.status(401).send("Ongeautoriseerd");
  res.status(200).send("Ontvangen!");
  try { await verwerk(JSON.parse(req.body.toString())); } catch (e) { console.error("❌ Fout:", e.message); }
});

app.get("/", (req, res) => {
  res.send(`
    <h1>✅ Sportbrillenshop Helper v13</h1>
    <p>${SHOPIFY_SHOP_DOMAIN ? "✅" : "❌"} ${SHOPIFY_SHOP_DOMAIN || "niet ingesteld"}</p>
    <p>${SHOPIFY_CLIENT_ID ? "✅" : "❌"} Client ID</p>
    <p>${SHOPIFY_CLIENT_SECRET ? "✅" : "❌"} Client Secret</p>
    <h2>Webhook URLs:</h2>
    <p><code>${req.protocol}://${req.get("host")}/webhook/product-created</code></p>
    <p><code>${req.protocol}://${req.get("host")}/webhook/product-updated</code></p>
  `);
});

const POORT = process.env.PORT || 3000;
app.listen(POORT, () => {
  console.log(`\n🚀 v13 gestart op poort ${POORT}`);
  console.log(`🏪 ${SHOPIFY_SHOP_DOMAIN || "❌ niet ingesteld"}`);
  console.log(`🔑 ${SHOPIFY_CLIENT_ID ? "✅" : "❌"}\n`);
});
