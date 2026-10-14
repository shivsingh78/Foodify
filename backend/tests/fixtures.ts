import mongoose from "mongoose";
import Item from "../src/models/item.model.js";
import Shop from "../src/models/shop.model.js";
import { createUserWithRole } from "./helpers.js";

export const setupShop = async (
  city = "Pune",
  items: { name: string; price: number; category?: string; foodType?: string; isAvailable?: boolean }[] = [
    { name: "Margherita", price: 200, category: "Pizza" },
    { name: "Veg Burger", price: 100, category: "Burgers" },
  ],
) => {
  const owner = await createUserWithRole("owner");
  const shop = await Shop.create({
    name: `Shop ${owner.user._id.slice(-4)}`,
    image: "https://example.com/shop.jpg",
    owner: owner.user._id,
    city,
    state: "MH",
    address: "1 Main St",
  });
  const created = [];
  for (const i of items) {
    const item = await Item.create({
      image: "https://example.com/i.jpg",
      category: "Others",
      foodType: "veg",
      ...i,
      shop: shop._id,
    });
    shop.items.push(item._id);
    created.push(item);
  }
  await shop.save();
  return { owner, shop, items: created };
};

export const address = { text: "12 Street, Pune", latitude: 18.52, longitude: 73.85 };

export const asId = (v: unknown) => new mongoose.Types.ObjectId(String(v));
