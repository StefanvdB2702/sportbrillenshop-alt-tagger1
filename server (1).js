// ============================================================
// Sportbrillenshop - Automatische Alt Tag Updater
// Versie 2 - werkt met het nieuwe Shopify Dev Dashboard
// ============================================================

const express = require("express");
const crypto = require("crypto");

const app = express();

// --- JOUW INSTELLINGEN (worden ingevuld via Render) ---
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN; // bijv. sportbrillenshop.myshopify.com
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Shopify stuurt de data als ruwe tekst — dit zorgt dat we die kunnen lezen
app.use(express.raw({ type: "application/json" }));

// ============================================================
// TOEGANGSTOKEN OPHALEN
// Het nieuwe systeem geeft geen vaste sleutel meer.
// In plaats daarvan halen we zelf elke 24 uur een nieuwe op.
// ============================================================
let cachedToken = null;
let tokenVerlooptOp = null;

async function haalToegangstokenOp() {
  // Controleer of we nog een geldig token hebben
  if (cachedToken && tokenVerlooptOp && new Date() < tokenVerlooptOp) {
    return cachedToken;
  }

  console.log("🔑 Nieuw toegangstoken ophalen bij Shopify...");

  const response = await fetch(
    `https://${SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    }
  );

  if (!response.ok) {
    const fout = await response.text();
    throw new Error(`Token ophalen mislukt: ${fout}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;

  // Token is 24 uur geldig — we vernieuwen hem na 23 uur
  tokenVerlooptOp = new Date(Date.now() + 23 * 60 * 60 * 1000);

  console.log("✅ Nieuw toegangstoken ontvangen!");
  return cachedToken;
}

// ============================================================
// HELPER FUNCTIE: Maakt een mooie bestandsnaam
// Voorbeeld: "Oakley Jawbreaker Rood" → "Oakley-Jawbreaker-Rood"
// ============================================================
function maakBestandsnaam(producttitel) {
  return producttitel
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-]/g, "")
    .replace(/-+/g, "-");
}

// ============================================================
// CONTROLEER OF HET BERICHT ECHT VAN SHOPIFY KOMT
// ============================================================
function isEchtShopifyBericht(body, handtekening) {
  if (!WEBHOOK_SECRET) return true;

  const verwachteHandtekening = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(handtekening || "", "base64"),
      Buffer.from(verwachteHandtekening, "base64")
    );
  } catch {
    return false;
  }
}

// ============================================================
// STAP 1: Haal alle foto's op van een product
// ============================================================
async function haalFotosOp(productId, token) {
  const query = `
    query getProductMedia($id: ID!) {
      product(id: $id) {
        title
        media(first: 50) {
          edges {
            node {
              id
              alt
              mediaContentType
            }
          }
        }
      }
    }
  `;

  const response = await fetch(
    `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2025-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables: { id: productId } }),
    }
  );

  const data = await response.json();
  return data.data?.product;
}

// ============================================================
// STAP 2: Pas de alt tag aan van alle foto's
// ============================================================
async function pasAltTagAan(productId, mediaId, nieuweAltTag, token) {
  const mutation = `
    mutation updateMediaAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
      productUpdateMedia(productId: $productId, media: $media) {
        media {
          id
          alt
        }
        mediaUserErrors {
          field
          message
        }
      }
    }
  `;

  const response = await fetch(
    `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2025-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          productId,
          media: [{ id: mediaId, alt: nieuweAltTag }],
        },
      }),
    }
  );

  const data = await response.json();
  return data.data?.productUpdateMedia;
}

// ============================================================
// HOOFDFUNCTIE: Verwerkt een nieuw product
// ============================================================
async function verwerkNieuwProduct(productData) {
  const shopifyProductId = `gid://shopify/Product/${productData.id}`;
  const producttitel = productData.title;
  const altTag = maakBestandsnaam(producttitel);

  console.log(`\n🛍️  Nieuw product: "${producttitel}"`);
  console.log(`📝 Alt tag wordt: "${altTag}"`);

  // Haal een toegangstoken op
  const token = await haalToegangstokenOp();

  // Wacht even — Shopify heeft soms een paar seconden nodig om foto's te verwerken
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Haal de foto's op
  const product = await haalFotosOp(shopifyProductId, token);

  if (!product) {
    console.log("❌ Product niet gevonden");
    return;
  }

  const fotos = product.media?.edges || [];
  console.log(`📸 Aantal foto's: ${fotos.length}`);

  if (fotos.length === 0) {
    console.log("ℹ️  Geen foto's bij dit product");
    return;
  }

  // Pas elke foto aan
  let aantalGelukt = 0;
  for (const { node: foto } of fotos) {
    if (foto.mediaContentType !== "IMAGE") continue;

    const resultaat = await pasAltTagAan(shopifyProductId, foto.id, altTag, token);

    if (resultaat?.mediaUserErrors?.length > 0) {
      console.log(`  ❌ Fout: ${resultaat.mediaUserErrors[0].message}`);
    } else {
      console.log(`  ✅ Alt tag ingesteld: "${altTag}"`);
      aantalGelukt++;
    }
  }

  console.log(`\n🎉 Klaar! ${aantalGelukt} foto('s) bijgewerkt voor "${producttitel}"`);
}

// ============================================================
// DE BEL: Luistert naar berichten van Shopify
// ============================================================
app.post("/webhook/product-created", async (req, res) => {
  const handtekening = req.headers["x-shopify-hmac-sha256"];

  if (!isEchtShopifyBericht(req.body, handtekening)) {
    console.log("⚠️  Ongeldig bericht — genegeerd");
    return res.status(401).send("Ongeautoriseerd");
  }

  // Stuur meteen "ontvangen!" terug naar Shopify
  res.status(200).send("Ontvangen!");

  // Verwerk op de achtergrond
  try {
    const productData = JSON.parse(req.body.toString());
    await verwerkNieuwProduct(productData);
  } catch (fout) {
    console.error("❌ Fout:", fout.message);
  }
});

// Test-pagina
app.get("/", (req, res) => {
  const shopIngesteld = SHOPIFY_SHOP_DOMAIN ? "✅" : "⚠️  Nog niet ingesteld";
  const clientIdIngesteld = SHOPIFY_CLIENT_ID ? "✅" : "⚠️  Nog niet ingesteld";
  const clientSecretIngesteld = SHOPIFY_CLIENT_SECRET ? "✅" : "⚠️  Nog niet ingesteld";

  res.send(`
    <h1>✅ Sportbrillenshop Alt Tag Helper werkt!</h1>
    <h2>Status:</h2>
    <p>${shopIngesteld} Winkel: ${SHOPIFY_SHOP_DOMAIN || "niet ingesteld"}</p>
    <p>${clientIdIngesteld} Client ID</p>
    <p>${clientSecretIngesteld} Client Secret</p>
    <h2>Webhook URL:</h2>
    <p><code>${req.protocol}://${req.get("host")}/webhook/product-created</code></p>
    <p><em>Kopieer deze URL en plak hem in Shopify bij de webhook-instellingen.</em></p>
  `);
});

// Start het programma
const POORT = process.env.PORT || 3000;
app.listen(POORT, () => {
  console.log(`\n🚀 Alt Tag Helper gestart op poort ${POORT}`);
  console.log(`🏪 Winkel: ${SHOPIFY_SHOP_DOMAIN || "⚠️  Nog niet ingesteld"}`);
  console.log(`🔑 Client ID: ${SHOPIFY_CLIENT_ID ? "✅" : "⚠️  Nog niet ingesteld"}`);
  console.log(`\nKlaar!\n`);
});
