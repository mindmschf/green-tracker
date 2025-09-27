export const WEBSITES = {
  SAZEN: {
    name: 'Sazen Tea',
    shouldRefetch: false,
    inventoryFile: 'sazen-matcha.json',
    categoryUrls: [
      'https://www.sazentea.com/en/products/c85-yamamasa-koyamaen-matcha',
      'https://www.sazentea.com/en/products/c24-marukyu-koyamaen-matcha',
      'https://www.sazentea.com/en/products/c114-kanbayashi-shunsho-matcha',
      'https://www.sazentea.com/en/products/c25-hekisuien-matcha',
      'https://www.sazentea.com/en/products/c41-horii-shichimeien-matcha',
      'https://www.sazentea.com/en/products/c26-hokoen-matcha',
    ],
  },
  IPPODO: {
    name: 'Ippodo Tea',
    shouldRefetch: false,
    inventoryFile: 'ippodo-matcha.json',
    productsJson: [
      'https://global.ippodo-tea.co.jp/collections/matcha/products.json',
    ],
  },
  NAKAMURA_TOKICHI: {
    name: 'Nakamura Tokichi',
    shouldRefetch: false,
    inventoryFile: 'nakamura-matcha.json',
    productsJson: [
      'https://global.tokichi.jp/collections/matcha/products.json',
    ],
  },
} as const;

export const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
