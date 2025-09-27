import { config } from 'dotenv';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { Telegraf } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';
import { HEADERS, WEBSITES } from './constants';
import { Product, ProductSummary, WebsiteStockMap, WebsiteKey } from './types';

import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Accept and store cookies to prevent sites from blocking too many requests
const jar = new CookieJar();
const client = wrapper(
  axios.create({
    jar,
    withCredentials: true, // Ensures cookies are included
    headers: HEADERS,
  })
);

// To prevent spamming too much if the in-stock doesn't change between checks
const STOCK_FILE = path.join(__dirname, 'previous-stock.json');

function readPreviousStock(): WebsiteStockMap {
  return fs.existsSync(STOCK_FILE)
    ? JSON.parse(fs.readFileSync(STOCK_FILE, 'utf8'))
    : {
        SAZEN: [],
        IPPODO: [],
        NAKAMURA_TOKICHI: [],
      };
}

function savePreviousStock(stockMap: WebsiteStockMap) {
  fs.writeFileSync(STOCK_FILE, JSON.stringify(stockMap, null, 2), 'utf8');
}

function readProductsFromFile(inventoryFile: string): Product[] {
  const filePath = path.join(__dirname, inventoryFile);
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } else {
    console.log(`${inventoryFile} file not found. Creating a new file.`);
    fs.writeFileSync(filePath, '[]', 'utf8');
    return [];
  }
}

async function checkStockStatus(product: Product): Promise<boolean> {
  return await client
    .get(product.url)
    .then((response) => {
      if (response.status >= 200 && response.status < 400) {
        const $ = cheerio.load(response.data);

        if (product.website === 'SAZEN') {
          const outOfStockText = $('p strong.red').text().trim();
          const inStockForm = $('form#basket-add');

          return (
            !outOfStockText.includes('This product is unavailable') &&
            inStockForm.length > 0
          );
        } else if (product.website === 'IPPODO') {
          // Look for any button inside .product-form__buttons without style="display: none"
          const visibleAddToCartButton = $(
            '.product-form__buttons button'
          ).filter((_, el) => {
            const style = $(el).attr('style') || '';
            return !style.includes('display: none');
          });

          return visibleAddToCartButton.length > 0;
        } else if (product.website === 'NAKAMURA_TOKICHI') {
          // Get submit button span text inside product-form__buttons
          const buttonText = $('div.product-form__buttons button span')
            .text()
            .trim();

          return buttonText === 'Add to cart';
        }
      }

      return false;
    })
    .catch((error) => {
      console.error(
        `Error fetching product page ${product.url} (${product.name}):`,
        error.status
      );
      return false;
    });
}

async function sendGroupedTelegramMessage(
  websiteKey: WebsiteKey,
  productsInStock: ProductSummary[],
  timestamp: string
) {
  if (productsInStock.length) {
    const productList = productsInStock
      .map(
        (product, index) =>
          `${index + 1}. <a href="${product.url}">${product.manufacturer} - ${
            product.name
          }</a>`
      )
      .join('\n');

    const website = WEBSITES[websiteKey].name;
    const message = `<b>${timestamp}</b>\n\n<b><u>${website}</u></b> stock update:\n${productList}`;

    console.log(message);
    await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, message, {
      parse_mode: 'HTML',
    });
  }
}

async function processWebsite(
  websiteKey: WebsiteKey,
  previousStockMap: WebsiteStockMap,
  currentStockMap: WebsiteStockMap
): Promise<{
  key: WebsiteKey;
  products: { manufacturer: string; name: string; url: string }[];
}> {
  const website = WEBSITES[websiteKey];
  const products = readProductsFromFile(website.inventoryFile);
  const productsInStock: typeof products = [];

  if (websiteKey === 'SAZEN') {
    // sazen literally times out if i send too many requests in one go so i have to run it sequentially..
    for (const product of products) {
      const isInStock = await checkStockStatus(product);
      if (isInStock) {
        productsInStock.push(product);
        currentStockMap[websiteKey].push(product.url);
      }
    }
  } else {
    const results = await Promise.allSettled(
      products.map(async (product) => {
        const isInStock = await checkStockStatus(product);
        return { product, isInStock };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.isInStock) {
        productsInStock.push(result.value.product);
        currentStockMap[websiteKey].push(result.value.product.url);
      } else if (result.status === 'rejected') {
        console.error('Error checking product:', result.reason);
      }
    }
  }

  // Check for changes
  const hasChanged =
    previousStockMap[websiteKey]?.length !==
      currentStockMap[websiteKey].length ||
    !previousStockMap[websiteKey]?.every((url) =>
      currentStockMap[websiteKey].includes(url)
    );

  if (hasChanged && productsInStock.length > 3) {
    return { key: websiteKey, products: productsInStock };
  } else {
    console.log(
      `No significant stock change for ${website.name}. Skipping message.`
    );
    return { key: websiteKey, products: [] };
  }
}

async function main() {
  const timestamp = new Date().toLocaleString('en-GB', {
    dateStyle: 'full',
    timeStyle: 'long',
    timeZone: 'Asia/Singapore',
  });
  console.log('main called:', timestamp);

  const previousStockMap = readPreviousStock();
  // set of products (URLs) from each site that are currently in stock
  const currentStockMap: WebsiteStockMap = {
    SAZEN: [],
    IPPODO: [],
    NAKAMURA_TOKICHI: [],
  };

  // Run all websites in parallel
  // const results = await Promise.all(
  //   (Object.keys(WEBSITES) as WebsiteKey[]).map((websiteKey) =>
  //     processWebsite(websiteKey, previousStockMap, currentStockMap)
  //   )
  // );
  // rip ippodo and nakamura :( can't afford anymore
  const result = await processWebsite(
    'SAZEN',
    previousStockMap,
    currentStockMap
  );

  // Save updated stock
  savePreviousStock(currentStockMap);

  // Send messages only for changed websites
  // for (const result of results) {
  if (result.products.length) {
    await sendGroupedTelegramMessage(result.key, result.products, timestamp);
  }
  // }
}

(async () => {
  console.log('Running bot script...');
  await main();
  console.log('Script execution completed.');
  process.exit(0); // Ensure the script exits after running
})();
