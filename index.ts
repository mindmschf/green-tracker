import { config } from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import { Telegraf } from "telegraf";
import * as fs from "fs";
import * as path from "path";
import { HEADERS, WebsiteKey, WEBSITES } from "./constants";

config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// To prevent spamming too much if the in-stock doesn't change between checks
const STOCK_FILE = path.join(__dirname, "previous-stock.json");
// website, urls
type WebsiteStockMap = Record<WebsiteKey, string[]>;

function readPreviousStock(): WebsiteStockMap {
  return fs.existsSync(STOCK_FILE)
    ? JSON.parse(fs.readFileSync(STOCK_FILE, "utf8"))
    : {
        SAZEN: [],
        IPPODO: [],
        NAKAMURA_TOKICHI: [],
      };
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
    console.log(`${inventoryFile} file not found. Creating a new file.`);
    fs.writeFileSync(filePath, "[]", "utf8");
    return [];
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
  } else if (product.website === "NAKAMURA_TOKICHI") {
    try {
      const response = await axios.get(product.url, { headers: HEADERS });
      const $ = cheerio.load(response.data);

      // Get submit button span text inside product-form__buttons
      const buttonText = $("div.product-form__buttons button span").text().trim();

      return buttonText === "Add to cart";
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

    const website = WEBSITES[websiteKey].name;
    const message = `<b>${timestamp}</b>\n\n<b><u>${website}</u></b> stock update:\n${productList}`;

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
  const currentStockMap: WebsiteStockMap = {
    SAZEN: [],
    IPPODO: [],
    NAKAMURA_TOKICHI: [],
  };
  const inStockProducts: {
    [K in WebsiteKey]: { manufacturer: string; name: string; url: string }[];
  } = {
    SAZEN: [],
    IPPODO: [],
    NAKAMURA_TOKICHI: [],
  };

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

(async () => {
  console.log("Running bot script...");
  await main();
  console.log("Script execution completed.");
  process.exit(0); // Ensure the script exits after running
})();
