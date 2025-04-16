import { config } from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import { Telegraf } from "telegraf";
import * as fs from "fs";
import * as path from "path";

config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

const WEBSITES = {
  SAZEN: {
    name: "Sazen Tea",
    shouldRefetch: false,
    inventoryFile: "sazen-matcha.json",
    categoryUrls: [
      "https://www.sazentea.com/en/products/c85-yamamasa-koyamaen-matcha",
      "https://www.sazentea.com/en/products/c24-marukyu-koyamaen-matcha",
      "https://www.sazentea.com/en/products/c114-kanbayashi-shunsho-matcha",
      "https://www.sazentea.com/en/products/c25-hekisuien-matcha",
      "https://www.sazentea.com/en/products/c41-horii-shichimeien-matcha",
      "https://www.sazentea.com/en/products/c26-hokoen-matcha",
    ],
  },
  IPPODO: {
    name: "Ippodo Tea",
    shouldRefetch: false,
    inventoryFile: "ippodo-matcha.json",
    categoryUrls: ["https://global.ippodo-tea.co.jp/collections/matcha"],
  },
};

type WebsiteKey = keyof typeof WEBSITES;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
};

// To prevent spamming too much if the in-stock doesn't change between checks
const STOCK_FILE = path.join(__dirname, "previous_stock.json");
// website, urls
type WebsiteStockMap = Record<WebsiteKey, string[]>;

function readPreviousStock(): WebsiteStockMap {
  return fs.existsSync(STOCK_FILE) ? JSON.parse(fs.readFileSync(STOCK_FILE, "utf8")) : { SAZEN: [], IPPODO: [] };
}

function savePreviousStock(stockMap: WebsiteStockMap) {
  fs.writeFileSync(STOCK_FILE, JSON.stringify(stockMap, null, 2), "utf8");
}

function readProductsFromFile(
  inventoryFile: string
): { website: WebsiteKey; manufacturer: string; name: string; url: string }[] {
  const filePath = path.join(__dirname, inventoryFile);
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } else {
    console.log(`${inventoryFile} file not found.`);
    return [];
  }
}

async function updateProductLinks() {
  // Sazen
  if (WEBSITES.SAZEN.shouldRefetch) {
    const products = new Map<string, { manufacturer: string; name: string }>();

    for (const categoryUrl of WEBSITES.SAZEN.categoryUrls) {
      try {
        const response = await axios.get(categoryUrl, { headers: HEADERS });
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
        console.error("Error fetching category page: ", categoryUrl, error);
      }
    }
  }

  // Ippodo
  if (WEBSITES.IPPODO.shouldRefetch) {
    // url, product name
    const products = new Map<string, string>();
    try {
      const response = await axios.get(WEBSITES.IPPODO.categoryUrls[0], { headers: HEADERS });
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
}

async function checkStockStatus(product: {
  website: WebsiteKey;
  manufacturer: string;
  name: string;
  url: string;
}): Promise<boolean> {
  if (product.website === "SAZEN") {
    try {
      const response = await axios.get(product.url, { headers: HEADERS });
      const $ = cheerio.load(response.data);

      const outOfStockText = $("p strong.red").text().trim();
      const inStockForm = $("form#basket-add");

      return !outOfStockText.includes("This product is unavailable") && inStockForm.length > 0;
    } catch (error) {
      console.error(`Error fetching product page (${product.url}):`, error);
      return false;
    }
  } else if (product.website === "IPPODO") {
    try {
      const response = await axios.get(product.url, { headers: HEADERS });
      const $ = cheerio.load(response.data);

      // Look for any button inside .product-form__buttons without style="display: none"
      const visibleAddToCartButton = $(".product-form__buttons button").filter((_, el) => {
        const style = $(el).attr("style") || "";
        return !style.includes("display: none");
      });

      return visibleAddToCartButton.length > 0;
    } catch (error) {
      console.error(`Error fetching product page (${product.url}):`, error);
      return false;
    }
  }
  return false;
}

async function sendGroupedTelegramMessage(
  websiteKey: WebsiteKey,
  productsInStock: { manufacturer: string; name: string; url: string }[],
  timestamp: string
) {
  if (productsInStock.length > 0) {
    const productList = productsInStock
      .map((product, index) => `${index + 1}. <a href="${product.url}">${product.manufacturer} - ${product.name}</a>`)
      .join("\n");

    const message = `<b>${timestamp}</b>\n\nThe following matcha is back in stock on <b><u>${websiteKey}</u></b>:\n${productList}`;

    console.log(message);
    await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, message, {
      parse_mode: "HTML",
    });
  }
}

async function main() {
  const now = new Date();
  const timestamp = now.toLocaleString("en-GB", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: "Asia/Singapore",
  });
  const jstHour = now.getUTCHours() + 9;
  console.log("main called", timestamp, jstHour);

  const previousStockMap = readPreviousStock();
  const currentStockMap: WebsiteStockMap = { SAZEN: [], IPPODO: [] };
  const inStockProducts: {
    [K in WebsiteKey]: { manufacturer: string; name: string; url: string }[];
  } = { SAZEN: [], IPPODO: [] };

  for (const websiteKey of Object.keys(WEBSITES) as WebsiteKey[]) {
    const website = WEBSITES[websiteKey];
    const products = readProductsFromFile(website.inventoryFile);
    const productsInStock = [];

    for (const product of products) {
      const isInStock = await checkStockStatus(product);
      if (isInStock) {
        productsInStock.push(product);
        currentStockMap[websiteKey].push(product.url);
      }
    }

    // Check for changes
    const hasChanged =
      previousStockMap[websiteKey]?.length !== currentStockMap[websiteKey].length ||
      !previousStockMap[websiteKey]?.every((url) => currentStockMap[websiteKey].includes(url));

    if (hasChanged && productsInStock.length > 0) {
      inStockProducts[websiteKey] = productsInStock;
    } else {
      console.log(`No stock change for ${website.name}. Skipping message.`);
    }
  }

  // Save updated stock
  savePreviousStock(currentStockMap);

  // Send messages only for changed websites
  for (const websiteKey of Object.keys(inStockProducts) as WebsiteKey[]) {
    if (inStockProducts[websiteKey].length > 0) {
      await sendGroupedTelegramMessage(websiteKey, inStockProducts[websiteKey], timestamp);
    }
  }
}

// NOTE: THIS WILL REMOVE/REPLACE PREVIOUSLY SAVED ITEMS. DO NOT RUN UNLESS NEEDED
// (async () => {
//   console.log("Updating inventory...");
//   await updateProductLinks();
//   console.log("Inventory updated.");
//   process.exit(0); // Ensure the script exits after running
// })();

 (async () => {
   console.log("Running bot script...");
   await main();
   console.log("Script execution completed.");
   process.exit(0); // Ensure the script exits after running
 })();

//export async function handler() {
  //console.log("Running bot script...");
  //await main();
 // console.log("Script execution completed.");
//}
