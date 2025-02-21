import { config } from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import { Telegraf } from "telegraf";
import * as fs from "fs";
import * as path from "path";

config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const CATEGORY_URLS = [
  "https://www.sazentea.com/en/products/c85-yamamasa-koyamaen-matcha",
  "https://www.sazentea.com/en/products/c24-marukyu-koyamaen-matcha",
  "https://www.sazentea.com/en/products/c114-kanbayashi-shunsho-matcha",
  "https://www.sazentea.com/en/products/c25-hekisuien-matcha",
  "https://www.sazentea.com/en/products/c41-horii-shichimeien-matcha",
];

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
};

// To prevent spamming too much if the in-stock doesn't change between checks
let previousInStockProducts: Set<string> = new Set();

function setsAreEqual(set1: Set<string>, set2: Set<string>): boolean {
  if (set1.size !== set2.size) return false;
  for (let item of set1) {
    if (!set2.has(item)) return false;
  }
  return true;
}

function readProductsFromFile(): { manufacturer: string; name: string; url: string }[] | null {
  const filePath = path.join(__dirname, "matcha.json");
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, "utf8");
    try {
      return JSON.parse(data);
    } catch (error) {
      console.error("Error parsing JSON file:", error);
      return null;
    }
  } else {
    console.log("matcha.json file not found.");
    return null;
  }
}

async function fetchProductLinks(): Promise<{ manufacturer: string; name: string; url: string }[]> {
  const products = new Map<string, { manufacturer: string; name: string }>();

  for (const categoryUrl of CATEGORY_URLS) {
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
    } catch (error) {
      console.error("Error fetching category page:", categoryUrl, error);
    }
  }

  return Array.from(products.entries()).map(([url, { manufacturer, name }]) => ({ manufacturer, name, url }));
}

async function saveProductsToFile() {
  const products = await fetchProductLinks();
  const jsonData = JSON.stringify(products, null, 2);
  fs.writeFileSync("matcha.json", jsonData, "utf8");
  console.log("Products data has been saved to matcha.json");
}

async function checkStockStatus(product: { manufacturer: string; name: string; url: string }): Promise<boolean> {
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
}

async function sendGroupedTelegramMessage(
  productsInStock: { manufacturer: string; name: string; url: string }[],
  timestamp: string
) {
  if (productsInStock.length > 0) {
    const currentProductUrls = new Set(productsInStock.map((product) => product.url));

    if (setsAreEqual(previousInStockProducts, currentProductUrls)) {
      console.log("No change in the list of in-stock products. Skipping message.");
      return;
    }

    previousInStockProducts = currentProductUrls;

    const productList = productsInStock
      .map((product, index) => `${index + 1}. <a href="${product.url}">${product.manufacturer} - ${product.name}</a>`)
      .join("\n");

    const message = `<b>${timestamp}</b>\n\nThe following matcha is back in stock:\n${productList}`;

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
  console.log("main called", timestamp);
  const jstHour = now.getUTCHours() + 9;

  if (jstHour >= 7 && jstHour < 23) {
    const products = await readProductsFromFile();
    const productsInStock: {
      manufacturer: string;
      name: string;
      url: string;
    }[] = [];

    if (!products) {
      return;
    }

    for (const product of products) {
      const isInStock = await checkStockStatus(product);
      if (isInStock) {
        productsInStock.push(product);
      }
    }

    await sendGroupedTelegramMessage(productsInStock, timestamp);
  } else {
    console.log("Outside of operation hours (7 AM - 11 PM JST). Skipping check.");
  }
}

// Uncomment this to update matcha list
// saveProductsToFile();

const interval = 120000; // 2 minutes interval
setInterval(main, interval);
