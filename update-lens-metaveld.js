// ============================================================
// Sportbrillenshop - Eenmalig script: custom.lens invullen
// voor alle bestaande producten
// Uitvoeren via: node update-lens-metaveld.js
// ============================================================

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;

// ============================================================
// TOKEN
// ============================================================
async function haalToken() {
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
  console.log("✅ Token ontvangen!");
  return data.access_token;
}

// ============================================================
// LENSNAAM BEPALEN UIT TITEL
// ============================================================
function bepaalLensnaam(titel) {
  const delen = titel.split("/");
  const lensDeel = delen[1] || "";
  const eersteLens = lensDeel.split("&")[0].trim();
  if (!eersteLens) return "";

  let lensnaam = eersteLens
    .replace(/ Snow /gi, " ")
    .replace(/ Snow$/gi, "")
    .replace(/ Iridium$/gi, "")
    .replace(/ Iridium /gi, " ")
    .replace(/ Polarized$/gi, "")
    .trim();

  lensnaam = lensnaam.split(" ")
    .map(woord => woord.charAt(0).toUpperCase() + woord.slice(1).toLowerCase())
    .join(" ");

  lensnaam = lensnaam
    .replace(/Prizm/gi, "Prizm")
    .replace(/\b24k\b/gi, "24K")
    .replace(/\bHi\b/gi, "Hi");

  return lensnaam;
}

// ============================================================
// GRAPHQL
// ============================================================
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
// HAAL ALLE PRODUCTEN OP (met paginering)
// ============================================================
async function haalAlleProducten(token) {
  let producten = [];
  let cursor = null;
  let heeftVolgende = true;

  while (heeftVolgende) {
    const data = await graphql(`
      query($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              metafields(first: 5, namespace: "custom") {
                edges { node { key value } }
              }
            }
          }
        }
      }
    `, { cursor }, token);

    const edges = data.data?.products?.edges || [];
    producten = producten.concat(edges.map(e => e.node));
    heeftVolgende = data.data?.products?.pageInfo?.hasNextPage || false;
    cursor = data.data?.products?.pageInfo?.endCursor || null;
    console.log(`📦 ${producten.length} producten opgehaald...`);
  }

  return producten;
}

// ============================================================
// METAVELD INSTELLEN
// ============================================================
async function stelLensIn(productId, lensnaam, token) {
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
      metafields: [{
        namespace: "custom",
        key: "lens",
        value: lensnaam,
        type: "single_line_text_field"
      }]
    }
  }, token);

  const fouten = data.data?.productUpdate?.userErrors || [];
  if (fouten.length > 0) {
    console.log(`  ❌ Fout: ${fouten[0].message}`);
    return false;
  }
  return true;
}

// ============================================================
// HOOFDFUNCTIE
// ============================================================
async function main() {
  console.log("🚀 Script gestart — custom.lens invullen voor alle producten\n");

  const token = await haalToken();
  const producten = await haalAlleProducten(token);

  console.log(`\n📋 Totaal ${producten.length} producten gevonden`);
  console.log("▶️  Starten met bijwerken...\n");

  let gelukt = 0;
  let overgeslagen = 0;
  let geenLens = 0;

  for (const product of producten) {
    const lensnaam = bepaalLensnaam(product.title);

    if (!lensnaam) {
      console.log(`⏭️  "${product.title}" — geen lens gevonden in titel`);
      geenLens++;
      continue;
    }

    // Check of lens al ingevuld is
    const huidigelens = product.metafields?.edges?.find(e => e.node.key === "lens")?.node?.value || "";
    if (huidigelens === lensnaam) {
      console.log(`⏭️  "${product.title}" — lens al correct: "${lensnaam}"`);
      overgeslagen++;
      continue;
    }

    const succes = await stelLensIn(product.id, lensnaam, token);
    if (succes) {
      console.log(`✅ "${product.title}" → "${lensnaam}"`);
      gelukt++;
    }

    // Kleine pauze om Shopify niet te overbelasten
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n🎉 Klaar!`);
  console.log(`✅ Bijgewerkt: ${gelukt}`);
  console.log(`⏭️  Al correct: ${overgeslagen}`);
  console.log(`❓ Geen lens gevonden: ${geenLens}`);
}

main().catch(console.error);
