import { config } from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";
import { WEBSITES, HEADERS } from "./constants";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

config();

// Accept and store cookies to prevent sites from blocking too many requests
const jar = new CookieJar();
const client = wrapper(
  axios.create({
    jar,
    withCredentials: true, // Ensures cookies are included
    headers: HEADERS,
  })
);

async function updateProductLinks() {
  // Sazen
  if (WEBSITES.SAZEN.shouldRefetch) {
    const products = new Map<string, { manufacturer: string; name: string }>();

    for (const categoryUrl of WEBSITES.SAZEN.categoryUrls) {
      try {
        const response = await client.get(categoryUrl);
        const $ = cheerio.load(response.data);

        // 0. Get manufacturer name (h1 tag)
        const manufacturer = $("div#content h1").first().text().trim();

        // 1. Select links inside <div class="product-name">
        $('div.product-name a[href^="/en/products/"]').each((_, element) => {
          const name = $(element).text().trim();
          const url = "https://www.sazentea.com" + $(element).attr("href");
          products.set(url, { manufacturer, name });
        });

        // 2. Select the second column <td> in each row <tr>
        $("tr").each((_, row) => {
          const secondColumn = $(row).find('td:nth-child(2) a[href^="/en/products/"]');
          if (secondColumn.length > 0) {
            const name = secondColumn.text().trim();
            const url = "https://www.sazentea.com" + secondColumn.attr("href");
            products.set(url, { manufacturer, name });
          }
        });

        // Update products link file
        const mapped = Array.from(products.entries()).map(([url, { manufacturer, name }]) => ({
          website: "SAZEN",
          manufacturer,
          name,
          url,
        }));
        const jsonData = JSON.stringify(mapped, null, 2);
        fs.writeFileSync(WEBSITES.SAZEN.inventoryFile, jsonData, "utf8");
      } catch (error) {
        console.error("Error fetching Sazen page: ", categoryUrl, error);
      }
    }
  }

  // Ippodo
  if (WEBSITES.IPPODO.shouldRefetch) {
    // url, product name
    const products = new Map<string, string>();
    try {
      const response = await client.get(WEBSITES.IPPODO.categoryUrls[0]);
      const $ = cheerio.load(response.data);

      // 1. Select links inside <a class="a-link-product--type01">
      $("a.a-link-product--type01").each((_, element) => {
        const name = $(element).text().trim();
        const url = "https://global.ippodo-tea.co.jp" + $(element).attr("href");
        products.set(url, name);
      });

      // Update products link file
      const manufacturer = WEBSITES.IPPODO.name;
      const mapped = Array.from(products.entries()).map(([url, name]) => ({
        website: "IPPODO",
        manufacturer,
        name,
        url,
      }));
      const jsonData = JSON.stringify(mapped, null, 2);
      fs.writeFileSync(WEBSITES.IPPODO.inventoryFile, jsonData, "utf8");
    } catch (error) {
      console.error("Error fetching Ippodo page: ", error);
    }
  }

  // Nakamura
  if (WEBSITES.NAKAMURA_TOKICHI.shouldRefetch) {
    // url, product name
    const products = new Map<string, string>();
    for (const categoryUrl of WEBSITES.NAKAMURA_TOKICHI.categoryUrls) {
      try {
        const response = await client.get(categoryUrl);
        const $ = cheerio.load(response.data);

        // 1. Select links inside <div class="card__information">
        $("div.card__information").each((_, element) => {
          const link = $(element).find("a").attr("href");
          const name = $(element).find("h3.tatata.card__heading").text().trim();
          if (link && name) {
            const url = "https://global.tokichi.jp" + link;
            products.set(url, name);
          }
        });

        // Update products link file
        const manufacturer = WEBSITES.NAKAMURA_TOKICHI.name;
        const mapped = Array.from(products.entries()).map(([url, name]) => ({
          website: "NAKAMURA_TOKICHI",
          manufacturer,
          name,
          url,
        }));
        const jsonData = JSON.stringify(mapped, null, 2);
        fs.writeFileSync(WEBSITES.NAKAMURA_TOKICHI.inventoryFile, jsonData, "utf8");
      } catch (error) {
        console.error("Error fetching Nakamura Tokichi page: ", error);
      }
    }
  }
}

// NOTE: IF shouldRefetch == true, THIS WILL REMOVE/REPLACE PREVIOUSLY SAVED ITEMS.
// DO NOT RUN UNLESS NEEDED
(async () => {
  console.log("Updating inventory...");
  await updateProductLinks();
  console.log("Inventory updated.");
  process.exit(0); // Ensure the script exits after running
})();
