import mongoose, { type Types } from "mongoose";

export interface IRating {
  user: Types.ObjectId;
  item: Types.ObjectId;
  value: number;
}

const ratingSchema = new mongoose.Schema<IRating>(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    value: { type: Number, min: 1, max: 5, required: true },
  },
  { timestamps: true },
);

// One rating per customer per item.
ratingSchema.index({ user: 1, item: 1 }, { unique: true });

const Rating = mongoose.model<IRating>("Rating", ratingSchema);

export default Rating;
