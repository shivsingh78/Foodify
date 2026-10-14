import mongoose, { type HydratedDocument, type Types } from "mongoose";
import { FOOD_TYPES, ITEM_CATEGORIES } from "@foodify/validation";

export interface IItem {
  name: string;
  image: string;
  shop: Types.ObjectId;
  category: (typeof ITEM_CATEGORIES)[number];
  price: number;
  foodType: (typeof FOOD_TYPES)[number];
  isAvailable: boolean;
  rating: { average: number; count: number };
}

export type ItemDocument = HydratedDocument<IItem>;

const itemSchema = new mongoose.Schema<IItem>(
  {
    name: { type: String, required: true },
    image: { type: String, required: true },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop" },
    category: { type: String, enum: ITEM_CATEGORIES, required: true },
    price: { type: Number, min: 0, required: true },
    foodType: { type: String, enum: FOOD_TYPES, required: true },
    // Existing documents have no flag; Mongoose applies the default on read.
    isAvailable: { type: Boolean, default: true },
    rating: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

itemSchema.index({ shop: 1, category: 1 });
itemSchema.index({ shop: 1, price: 1 });
itemSchema.index({ "rating.average": -1 });

const Item = mongoose.model<IItem>("Item", itemSchema);

export default Item;
