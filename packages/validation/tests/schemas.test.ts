import { describe, expect, it } from "vitest";
import {
  buildPaginationMeta,
  itemSearchQuerySchema,
  placeOrderSchema,
  signUpSchema,
  updateOrderStatusSchema,
} from "../src/index.js";

const id = "a".repeat(24);

describe("shared schemas", () => {
  it("normalises email and rejects unknown/privileged fields on signup", () => {
    const ok = signUpSchema.parse({ fullName: "Ann Lee", email: " ANN@Example.com ", password: "password1", mobile: "9876543210" });
    expect(ok.email).toBe("ann@example.com");
    expect(signUpSchema.safeParse({ ...ok, role: "owner" }).success).toBe(false);
  });

  it("rejects client-controlled prices and totals on orders", () => {
    const base = { paymentMethod: "cod", deliveryAddress: { text: "x", latitude: 1, longitude: 2 }, cartItems: [{ id, quantity: 1 }] };
    expect(placeOrderSchema.safeParse(base).success).toBe(true);
    expect(placeOrderSchema.safeParse({ ...base, totalAmount: 1 }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, cartItems: [{ id, quantity: 1, price: 0 }] }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, cartItems: [{ id: "bad", quantity: 1 }] }).success).toBe(false);
  });

  it("does not allow owners to set 'delivered' directly", () => {
    expect(updateOrderStatusSchema.safeParse({ status: "delivered" }).success).toBe(false);
  });

  it("applies pagination defaults and limits", () => {
    expect(itemSearchQuerySchema.parse({ city: "Pune" })).toMatchObject({ page: 1, limit: 20, sort: "relevance" });
    expect(itemSearchQuerySchema.safeParse({ city: "Pune", limit: 500 }).success).toBe(false);
    expect(buildPaginationMeta(2, 10, 25)).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3, hasNextPage: true });
  });
});
