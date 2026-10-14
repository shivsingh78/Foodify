import mongoose, { type HydratedDocument, type Types } from "mongoose";

export interface IShop {
  name: string;
  image: string;
  owner: Types.ObjectId;
  city: string;
  state: string;
  address: string;
  items: Types.ObjectId[];
  description?: string;
  contactPhone?: string;
  /** Typical preparation time; falls back to DISPATCH_DEFAULT_PREP_MINUTES. */
  avgPrepMinutes?: number;
  location?: { type: "Point"; coordinates: [number, number] };
}

export type ShopDocument = HydratedDocument<IShop>;

const shopSchema = new mongoose.Schema<IShop>(
  {
    name: { type: String, required: true },
    image: { type: String, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    address: { type: String, required: true },
    items: [{ type: mongoose.Schema.Types.ObjectId, ref: "Item" }],
    description: String,
    contactPhone: String,
    avgPrepMinutes: { type: Number, min: 1, max: 120 },
    location: { type: { type: String, enum: ["Point"] }, coordinates: { type: [Number] } },
  },
  { timestamps: true },
);

shopSchema.index({ owner: 1 });
shopSchema.index({ city: 1 });

const Shop = mongoose.model<IShop>("Shop", shopSchema);

export default Shop;
