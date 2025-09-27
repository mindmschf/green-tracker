import { WEBSITES } from './constants';

export type WebsiteKey = keyof typeof WEBSITES;

export interface Product {
  website: WebsiteKey;
  manufacturer: string;
  name: string;
  url: string;
}

export type ProductSummary = Omit<Product, 'website'>;

export type WebsiteStockMap = Record<WebsiteKey, string[]>;
