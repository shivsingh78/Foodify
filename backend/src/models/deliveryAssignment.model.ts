import mongoose, { type HydratedDocument, type Types } from "mongoose";

export interface IDeliveryAssignment {
  order: Types.ObjectId;
  shop: Types.ObjectId;
  shopOrderId: Types.ObjectId;
  brodcastedTo: Types.ObjectId[];
  assignedTo: Types.ObjectId | null;
  status: "brodcasted" | "assigned" | "completed";
  acceptedAt?: Date;
}

export type DeliveryAssignmentDocument = HydratedDocument<IDeliveryAssignment>;

// `brodcasted` is the spelling already stored in existing documents.
const deliveryAssignmentSchema = new mongoose.Schema<IDeliveryAssignment>(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop" },
    shopOrderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    brodcastedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: ["brodcasted", "assigned", "completed"] },
    acceptedAt: Date,
  },
  { timestamps: true },
);

deliveryAssignmentSchema.index({ brodcastedTo: 1, status: 1 });
deliveryAssignmentSchema.index({ assignedTo: 1, status: 1 });
deliveryAssignmentSchema.index({ order: 1, shopOrderId: 1 });
// A delivery partner can hold at most one active assignment (race-free guarantee).
// A shop order has at most one active assignment, enforced by the database.
deliveryAssignmentSchema.index(
  { shopOrderId: 1 },
  { unique: true, partialFilterExpression: { status: "assigned" } },
);
deliveryAssignmentSchema.index(
  { assignedTo: 1 },
  { unique: true, partialFilterExpression: { status: "assigned" } },
);

const DeliveryAssignment = mongoose.model<IDeliveryAssignment>(
  "DeliveryAssignment",
  deliveryAssignmentSchema,
);

export default DeliveryAssignment;
