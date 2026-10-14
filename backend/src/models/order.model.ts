import mongoose, { type HydratedDocument, type Types } from "mongoose";
import { ORDER_STATUSES, PAYMENT_METHODS, type GeoJsonPoint, type OrderStatus } from "@foodify/validation";

export interface IShopOrderItem {
  item: Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
}

export interface IShopOrder {
  _id: Types.ObjectId;
  shop: Types.ObjectId;
  owner: Types.ObjectId;
  subtotal: number;
  shopOrderItems: IShopOrderItem[];
  status: OrderStatus;
  assignment?: Types.ObjectId | null;
  assignedDeliveryBoy?: Types.ObjectId | null;
  /** SHA-256 hash of the delivery OTP. */
  deliveryOtp?: string | null;
  otpExpires?: Date | null;
  deliveryOtpAttempts: number;
  deliveredAt?: Date | null;
  cancelledAt?: Date | null;
  preparingAt?: Date | null;
  /** When the food is expected to be ready (preparingAt + preparation estimate). */
  readyAt?: Date | null;
  pickedUpAt?: Date | null;
  /** Current ETA estimate; revised on assignment, material partner movement and pickup. */
  eta?: IEta | null;
  /** Frozen at partner assignment; the prediction that the ETA-accuracy metric evaluates. Never overwritten. */
  etaAtAssignment?: IEta | null;
}

export interface IEta {
  predictedAt: Date;
  /** What triggered this estimate. */
  basis: "assignment" | "partner_moved" | "pickup";
  /** Estimated time the partner reaches the restaurant. */
  partnerArrivalAt: Date | null;
  /** Estimated time the order is collected from the restaurant. */
  pickupAt: Date;
  /** Estimated time the order reaches the customer (an approximation, not a guarantee). */
  deliveryAt: Date;
  /** Partner position the estimate was based on, to throttle recomputation. */
  basisPoint?: { type: "Point"; coordinates: [number, number] } | null;
}

export interface IOrder {
  user: Types.ObjectId;
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  deliveryAddress: {
    text: string;
    latitude: number;
    longitude: number;
    /** GeoJSON mirror of latitude/longitude; absent on orders created before it existed. */
    location?: GeoJsonPoint;
  };
  /** Items total + delivery fee, always computed on the server. */
  totalAmount: number;
  deliveryFee: number;
  shopOrders: Types.DocumentArray<IShopOrder>;
  payment: boolean;
  paidAt?: Date | null;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type OrderDocument = HydratedDocument<IOrder>;

const etaSchema = new mongoose.Schema(
  {
    predictedAt: Date,
    basis: { type: String, enum: ["assignment", "partner_moved", "pickup"] },
    partnerArrivalAt: { type: Date, default: null },
    pickupAt: Date,
    deliveryAt: Date,
    basisPoint: { type: { type: String, enum: ["Point"] }, coordinates: { type: [Number] } },
  },
  { _id: false },
);

const shopOrderItemSchema = new mongoose.Schema<IShopOrderItem>(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item" },
    name: String,
    price: Number,
    quantity: Number,
  },
  { timestamps: true },
);

const shopOrderSchema = new mongoose.Schema<IShopOrder>(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    subtotal: Number,
    shopOrderItems: [shopOrderItemSchema],
    status: { type: String, enum: ORDER_STATUSES, default: "pending" },
    assignment: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryAssignment" },
    assignedDeliveryBoy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    deliveryOtp: { type: String, default: null, select: false },
    otpExpires: { type: Date, default: null, select: false },
    deliveryOtpAttempts: { type: Number, default: 0, select: false },
    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    preparingAt: { type: Date, default: null },
    readyAt: { type: Date, default: null },
    pickedUpAt: { type: Date, default: null },
    eta: { type: etaSchema, default: null },
    etaAtAssignment: { type: etaSchema, default: null },
  },
  { timestamps: true },
);

const orderSchema = new mongoose.Schema<IOrder>(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    deliveryAddress: {
      text: String,
      latitude: Number,
      longitude: Number,
      location: {
        type: { type: String, enum: ["Point"] },
        coordinates: { type: [Number] },
      },
    },
    totalAmount: { type: Number },
    deliveryFee: { type: Number, default: 0 },
    shopOrders: [shopOrderSchema],
    payment: { type: Boolean, default: false },
    paidAt: { type: Date, default: null },
    razorpayOrderId: { type: String, default: "" },
    razorpayPaymentId: { type: String, default: "" },
    idempotencyKey: { type: String },
  },
  { timestamps: true },
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ "shopOrders.owner": 1, createdAt: -1 });
orderSchema.index({ "shopOrders.shop": 1, createdAt: -1 });
orderSchema.index({ "shopOrders.status": 1 });
orderSchema.index({ razorpayOrderId: 1 });
orderSchema.index({ razorpayPaymentId: 1 });
orderSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);

const Order = mongoose.model<IOrder>("Order", orderSchema);

export default Order;
