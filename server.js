// ============================================================
// Sportbrillenshop - Alt Tag + Bestandsnaam + Metavelden Updater
// Versie 15 - met framekleur, lenskleur, dubbele lens support
// ============================================================

const express = require("express");
const crypto = require("crypto");
const app = express();

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const EXCEL_URL = "https://raw.githubusercontent.com/StefanvdB2702/sportbrillenshop-alt-tagger1/main/Goggles%202026.xlsx";

app.use(express.raw({ type: "application/json" }));

// ============================================================
// FRAMEKLEUR VERTAALTABEL
// ============================================================
const FRAMEKLEUR_MAP = {
  "matte black": "Zwart",
  "black thermal": "Zwart",
  "black": "Zwart",
  "polished black": "Zwart",
  "matte white": "Wit",
  "polished white": "Wit",
  "team colors polished white": "Wit",
  "carbon": "Grijs",
  "matte grey": "Grijs",
  "matte grey ink": "Grijs",
  "matte forged iron": "Grijs",
  "grey terrein": "Grijs",
  "steel": "Grijs",
  "matte navy": "Blauw",
  "blue haze": "Blauw",
  "horizon": "Blauw",
  "warp": "Blauw",
  "sky blue": "Blauw",
  "matte sapphire": "Blauw",
  "sapphire fade": "Blauw",
  "matte redline": "Rood",
  "redline": "Rood",
  "red": "Rood",
  "sand motion": "Beige",
  "sand": "Beige",
  "dark brush": "Groen",
  "new dark brush": "Groen",
  "fern": "Groen",
  "jasmine": "Groen",
  "matte celeste": "Groen",
  "matte viridian": "Groen",
  "lavender": "Paars",
  "pink milkshake": "Roze",
  "tennis ball yellow": "Geel",
  "fraktel stonewash": "Meerkleurig",
  "heat map": "Meerkleurig",
  "matte green purple colorshift splatter": "Meerkleurig",
};

// ============================================================
// LENSKLEUR VERTAALTABEL
// ============================================================
const LENSKLEUR_MAP = {
  "prizm sapphire": "Blauw",
  "prizm argon": "Blauw",
  "prizm iced": "Blauw",
  "prizm deep water": "Blauw",
  "prizm road jade": "Groen",
  "prizm jade": "Groen",
  "prizm golf": "Groen",
  "prizm shallow water": "Groen",
  "prizm torch": "Rood",
  "prizm trail torch": "Rood",
  "prizm road": "Rood",
  "prizm ruby": "Rood",
  "prizm field": "Rood",
  "prizm road black": "Zwart",
  "prizm black": "Zwart",
  "prizm dark grey": "Grijs",
  "prizm grey": "Grijs",
  "prizm clear": "Doorzichtig",
  "prizm garnet": "Oranje",
  "prizm persimmon": "Oranje",
  "prizm trail": "Oranje",
  "prizm sage gold": "Goud",
  "prizm 24k": "Goud",
  "prizm tungsten": "Bruin",
  "prizm dark golf": "Bruin",
  "prizm rose gold": "Roze",
  "prizm hi pink": "Roze",
  "prizm snow rose": "Roze",
  "prizm peach": "Roze",
};

// ============================================================
// LICHTDOORLAATBAARHEID SKIBRILLEN
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
// SKU VERTALING: OO7149-09 → 71490900
// ============================================================
function vertaalSku(shopifySku) {
  const zonder_oo = shopifySku.replace(/^OO/i, "");
  const delen = zonder_oo.split("-");
  if (delen.length !== 2) return null;
  const model = delen[0];
  const kleur = delen[1].padStart(2, "0");
  return `${model}${kleur}00`;
}

// ============================================================
// EXCEL OPHALEN
// ============================================================
async function zoekInExcel(shopifySku) {
  try {
    const excelCode = vertaalSku(shopifySku);
    if (!excelCode) {
      console.log(`  ⚠️ SKU formaat niet herkend: ${shopifySku}`);
      return null;
    }
    console.log(`  🔍 Zoek Excel code: ${excelCode}`);
    const res = await fetch(EXCEL_URL);
    if (!res.ok) { console.log(`  ❌ Excel ophalen mislukt: ${res.status}`); return null; }
    const buffer = await res.arrayBuffer();
    const XLSX = require('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rijen = XLSX.utils.sheet_to_json(ws, { header: 1 });
    for (const rij of rijen) {
      if (rij[9] && String(rij[9]).trim() === excelCode) {
        return {
          gtin: String(rij[0] || "").trim(),
          vergelijkingsprijs: String(rij[3] || "").trim(),
          framekleur: String(rij[14] || "").trim(),
          lenskleur: String(rij[15] || "").trim(),
        };
      }
    }
    console.log(`  ⚠️ SKU niet gevonden: ${excelCode}`);
    return null;
  } catch (fout) {
    console.log(`  ❌ Excel fout: ${fout.message}`);
    return null;
  }
}

// ============================================================
// KLEUR BEPALEN UIT TITEL
// ============================================================
function bepaalFramekleur(titelDeel) {
  // titelDeel = alles vóór de /
  const lower = titelDeel.toLowerCase();
  // Sorteer op lengte zodat langere keys eerst worden gecontroleerd
  const gesorteerd = Object.entries(FRAMEKLEUR_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [sleutel, kleur] of gesorteerd) {
    if (lower.includes(sleutel)) return kleur;
  }
  return "";
}

function bepaalLenskleur(lensNaam) {
  // Verwijder "snow", "iridium", "polarized" want die veranderen de kleur niet
  const lower = lensNaam.toLowerCase()
    .replace(" snow ", " ")
    .replace(" iridium", "")
    .replace(" polarized", "")
    .trim();
  const gesorteerd = Object.entries(LENSKLEUR_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [sleutel, kleur] of gesorteerd) {
    if (lower.includes(sleutel)) return kleur;
  }
  return "";
}

function bepaalLensdata(lensNaam, isSkibril) {
  if (!isSkibril) return { lichtdoorlaatbaarheid: "", categorie: "" };
  const lower = lensNaam.toLowerCase()
    .replace("prizm snow ", "")
    .replace("prizm ", "")
    .replace(" iridium", "")
    .trim();
  for (const [sleutel, waarde] of Object.entries(LENS_DATA_SKIBRIL)) {
    if (lower.includes(sleutel)) return waarde;
  }
  return { lichtdoorlaatbaarheid: "", categorie: "" };
}

// ============================================================
// KLEUR + LENSDATA UIT PRODUCTTITEL HALEN
// ============================================================
function bepaalKleuren(titel) {
  const titelLower = titel.toLowerCase();
  const isSkibril = SKIBRIL_MODELLEN.some(model => titelLower.includes(model));

  // Splits op /
  const delen = titel.split("/");
  const frameDeel = delen[0] || "";
  const lensDeel = delen[1] || "";

  // Framekleur
  const kleurFrame = bepaalFramekleur(frameDeel);

  // Lenskleuren — splits op & voor dubbele lenzen
  const lenzen = lensDeel.split("&").map(l => l.trim());
  const eersteLens = lenzen[0] || "";
  const tweedeLens = lenzen[1] || "";

  // Kleur van eerste lens (voor filter)
  const kleurLens = bepaalLenskleur(eersteLens);

  // Lichtdoorlaatbaarheid + categorie
  let lichtdoorlaatbaarheid = "";
  let categorie = "";

  if (isSkibril) {
    const data1 = bepaalLensdata(eersteLens, true);
    if (tweedeLens) {
      const data2 = bepaalLensdata(tweedeLens, true);
      lichtdoorlaatbaarheid = [data1.lichtdoorlaatbaarheid, data2.lichtdoorlaatbaarheid].filter(Boolean).join(" & ");
      categorie = [data1.categorie, data2.categorie].filter(Boolean).join(" & ");
    } else {
      lichtdoorlaatbaarheid = data1.lichtdoorlaatbaarheid;
      categorie = data1.categorie;
    }
  }

  console.log(`  🎨 Framekleur: "${kleurFrame}", Lenskleur: "${kleurLens}"`);
  if (lichtdoorlaatbaarheid) console.log(`  💡 Lichtdoorlaatbaarheid: "${lichtdoorlaatbaarheid}", Categorie: "${categorie}"`);

  return { kleurFrame, kleurLens, lichtdoorlaatbaarheid, categorie };
}

// ============================================================
// METAVELDEN BEPALEN
// ============================================================
function bepaalMetavelden(titel, csvData, kleuren) {
  const titelLower = titel.toLowerCase();

  const maat = / xl\b| xm\b/.test(titelLower)
    ? (/ xl\b/.test(titelLower) ? "L" : "M")
    : / l\b/.test(titelLower) ? "L"
    : / m\b/.test(titelLower) ? "M"
    : / s\b/.test(titelLower) ? "S" : "";

  return {
    "custom.size": maat,
    "custom.prizm": titelLower.includes("prizm") ? "ja" : "nee",
    "custom.transition": (titelLower.includes("photochromic") || titelLower.includes("photochromatisch")) ? "ja" : "nee",
    "custom.polarized": titelLower.includes("polarized") ? "ja" : "nee",
    "custom.brand": titel.split(" ")[0],
    "custom.gender": "unisex",
    "custom.materiaal": kleuren.lichtdoorlaatbaarheid,
    "custom.categorie_lens": kleuren.categorie,
    "custom.gtin": csvData?.gtin || "",
    "custom.kleur_frame": kleuren.kleurFrame,
    "custom.kleur_lens": kleuren.kleurLens,
  };
}

// ============================================================
// METAVELDEN OPHALEN
// ============================================================
async function haalMetaveldenOp(productId, token) {
  const data = await graphql(`
    query($id: ID!) {
      product(id: $id) {
        metafields(first: 25) {
          edges { node { namespace key value } }
        }
        variants(first: 1) {
          edges { node { id sku } }
        }
      }
    }
  `, { id: productId }, token);

  const metafields = {};
  for (const { node } of data.data?.product?.metafields?.edges || []) {
    metafields[`${node.namespace}.${node.key}`] = node.value;
  }
  const sku = data.data?.product?.variants?.edges?.[0]?.node?.sku || "";
  const variantId = data.data?.product?.variants?.edges?.[0]?.node?.id || "";
  return { metafields, sku, variantId };
}

// ============================================================
// METAVELDEN INSTELLEN
// ============================================================
async function stelMetaveldenIn(productId, metavelden, token) {
  const input = Object.entries(metavelden)
    .filter(([_, v]) => v !== "")
    .map(([sleutel, waarde]) => {
      const [namespace, key] = sleutel.split(".");
      return { namespace, key, value: waarde, type: "single_line_text_field" };
    });
  if (input.length === 0) return;
  const data = await graphql(`
    mutation($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id }
        userErrors { field message }
      }
    }
  `, { input: { id: productId, metafields: input } }, token);
  const fouten = data.data?.productUpdate?.userErrors || [];
  if (fouten.length > 0) { console.log(`  ❌ Metavelden fout: ${fouten[0].message}`); }
  else { console.log(`  ✅ ${input.length} metavelden ingesteld`); }
}

// ============================================================
// BARCODE + ARTIKELNUMMER + VERGELIJKINGSPRIJS
// ============================================================
async function stelVariantIn(productId, variantId, sku, gtin, vergelijkingsprijs, token) {
  // Artikelnummer als metaveld
  const metaData = await graphql(`
    mutation($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id }
        userErrors { field message }
      }
    }
  `, { input: { id: productId, metafields: [{ namespace: "custom", key: "artikelnummer", value: sku, type: "single_line_text_field" }] } }, token);
  const metaFouten = metaData.data?.productUpdate?.userErrors || [];
  if (metaFouten.length > 0) { console.log(`  ❌ Artikelnummer fout: ${metaFouten[0].message}`); }
  else { console.log(`  ✅ custom.artikelnummer: "${sku}"`); }

  // Barcode + vergelijkingsprijs op variant
  if (variantId) {
    const variantInput = { id: variantId };
    if (gtin) variantInput.barcode = gtin;
    if (vergelijkingsprijs) variantInput.compareAtPrice = vergelijkingsprijs;

    const varData = await graphql(`
      mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id barcode compareAtPrice }
          userErrors { field message }
        }
      }
    `, { productId, variants: [variantInput] }, token);
    const varFouten = varData.data?.productVariantsBulkUpdate?.userErrors || [];
    if (varFouten.length > 0) { console.log(`  ❌ Variant fout: ${varFouten[0].message}`); }
    else {
      if (gtin) console.log(`  ✅ Barcode: "${gtin}"`);
      if (vergelijkingsprijs) console.log(`  ✅ Vergelijkingsprijs: "€${vergelijkingsprijs}"`);
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
          edges { node { id mediaContentType alt ... on MediaImage { mimeType } } }
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
  await new Promise(r => setTimeout(r, 3000));

  const { metafields: huidigeMetavelden, sku, variantId } = await haalMetaveldenOp(productId, token);
  console.log(`🏷️  SKU: "${sku || "nog niet ingevuld"}"`);

  // Kleuren altijd bepalen uit titel (ook zonder SKU)
  const kleuren = bepaalKleuren(titel);

  // Basis metavelden altijd instellen (ook zonder SKU)
  const basisMetavelden = {
    "custom.prizm": titel.toLowerCase().includes("prizm") ? "ja" : "nee",
    "custom.transition": (titel.toLowerCase().includes("photochromic") || titel.toLowerCase().includes("photochromatisch")) ? "ja" : "nee",
    "custom.polarized": titel.toLowerCase().includes("polarized") ? "ja" : "nee",
    "custom.brand": titel.split(" ")[0],
    "custom.gender": "unisex",
    "custom.kleur_frame": kleuren.kleurFrame,
    "custom.kleur_lens": kleuren.kleurLens,
  };

  // Maat toevoegen
  const titelLower = titel.toLowerCase();
  const maat = / xl\b| xm\b/.test(titelLower)
    ? (/ xl\b/.test(titelLower) ? "L" : "M")
    : / l\b/.test(titelLower) ? "L"
    : / m\b/.test(titelLower) ? "M"
    : / s\b/.test(titelLower) ? "S" : "";
  if (maat) basisMetavelden["custom.size"] = maat;

  // Lichtdoorlaatbaarheid + categorie toevoegen als bekend
  if (kleuren.lichtdoorlaatbaarheid) basisMetavelden["custom.materiaal"] = kleuren.lichtdoorlaatbaarheid;
  if (kleuren.categorie) basisMetavelden["custom.categorie_lens"] = kleuren.categorie;

  await stelMetaveldenIn(productId, basisMetavelden, token);

  // SKU-afhankelijke metavelden alleen als SKU gewijzigd is
  const vorigeArtikelnummer = huidigeMetavelden["custom.artikelnummer"] || "";
  const skuIsGewijzigd = sku && sku.trim() !== "" && sku.trim() !== vorigeArtikelnummer.trim();

  console.log(`🔄 SKU gewijzigd: ${skuIsGewijzigd ? "ja" : "nee"}`);

  if (skuIsGewijzigd) {
    const csvData = await zoekInExcel(sku);
    if (csvData?.gtin) {
      await stelMetaveldenIn(productId, { "custom.gtin": csvData.gtin }, token);
    }
    await stelVariantIn(productId, variantId, sku, csvData?.gtin, csvData?.vergelijkingsprijs, token);
  } else if (!sku || sku.trim() === "") {
    console.log(`ℹ️  Geen SKU — GTIN wordt ingesteld zodra SKU wordt ingevoerd`);
  } else {
    console.log(`ℹ️  SKU ongewijzigd — GTIN/barcode niet overschreven`);
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
    console.log(`  📌 Alt tag: "${foto.alt || "(leeg)"}"`);
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
    <h1>✅ Sportbrillenshop Helper v15</h1>
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
  console.log(`\n🚀 v15 gestart op poort ${POORT}`);
  console.log(`🏪 ${SHOPIFY_SHOP_DOMAIN || "❌ niet ingesteld"}`);
  console.log(`🔑 ${SHOPIFY_CLIENT_ID ? "✅" : "❌"}\n`);
});
