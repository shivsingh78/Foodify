import mongoose from "mongoose";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toGeoJsonPoint } from "@foodify/validation";
import Order from "../src/models/order.model.js";
import { address, setupShop } from "./fixtures.js";
import { app, createUserWithRole, useTestDb } from "./helpers.js";

useTestDb();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

const place = {
  formatted: "221B Baker Street, London",
  address_line1: "221B Baker Street",
  address_line2: "London",
  city: "London",
  state: "England",
  country: "United Kingdom",
  lat: 51.5237,
  lon: -0.1585,
};

describe("geocoding proxy", () => {
  it("requires authentication", async () => {
    expect((await request(app).get("/api/geo/autocomplete?text=baker")).status).toBe(401);
  });

  it("returns normalised places and calls only the fixed Geoapify host with the server key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [place, { formatted: "no coords" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = await createUserWithRole("user");

    const res = await request(app).get("/api/geo/autocomplete?text=baker%20street").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({ formatted: place.formatted, latitude: 51.5237, longitude: -0.1585, city: "London" }),
    ]); // results without coordinates are dropped

    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe("https://api.geoapify.com/v1/geocode/autocomplete");
    expect(url.searchParams.get("apiKey")).toBe("test-geoapify-key");
    expect(url.searchParams.get("text")).toBe("baker street");
    expect(JSON.stringify(res.body)).not.toContain("test-geoapify-key");
  });

  it("cannot be steered to another host through input", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = await createUserWithRole("user");
    await request(app).get("/api/geo/autocomplete").query({ text: "https://evil.example/x?a=b&apiKey=steal" }).set("Cookie", cookie);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.hostname).toBe("api.geoapify.com");
    expect(url.searchParams.get("apiKey")).toBe("test-geoapify-key");
  });

  it("returns an empty list when nothing matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ results: [] })));
    const { cookie } = await createUserWithRole("user");
    const res = await request(app).get("/api/geo/autocomplete?text=zzzzzzzz").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it("maps upstream failures to 502 and timeouts to 504 without leaking details", async () => {
    const { cookie } = await createUserWithRole("user");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "key=secret" }, 500)));
    const bad = await request(app).get("/api/geo/autocomplete?text=baker").set("Cookie", cookie);
    expect(bad.status).toBe(502);
    expect(JSON.stringify(bad.body)).not.toContain("secret");

    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    expect((await request(app).get("/api/geo/autocomplete?text=baker").set("Cookie", cookie)).status).toBe(504);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    expect((await request(app).get("/api/geo/autocomplete?text=baker").set("Cookie", cookie)).status).toBe(502);
  });

  it("validates input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = await createUserWithRole("user");
    const get = (q: string) => request(app).get(`/api/geo/${q}`).set("Cookie", cookie);
    expect((await get("autocomplete?text=ab")).status).toBe(400);
    expect((await get(`autocomplete?text=${"a".repeat(201)}`)).status).toBe(400);
    expect((await get("autocomplete?text=abc&limit=99")).status).toBe(400);
    expect((await get("reverse?lat=91&lon=10")).status).toBe(400);
    expect((await get("reverse?lat=10&lon=181")).status).toBe(400);
    expect((await get("reverse?lat=abc&lon=10")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reverse geocodes a coordinate", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [place, place] }));
    vi.stubGlobal("fetch", fetchMock);
    const { cookie } = await createUserWithRole("user");
    const res = await request(app).get("/api/geo/reverse?lat=51.5237&lon=-0.1585").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("lat")).toBe("51.5237");
    expect(url.searchParams.get("lon")).toBe("-0.1585");
  });
});

describe("delivery address coordinates", () => {
  it("GeoJSON uses [longitude, latitude]", () => {
    expect(toGeoJsonPoint(18.52, 73.85)).toEqual({ type: "Point", coordinates: [73.85, 18.52] });
  });

  it("stores GeoJSON next to the legacy fields and rejects out-of-range coordinates", async () => {
    const { items } = await setupShop();
    const customer = await createUserWithRole("user");
    const order = (deliveryAddress: unknown) =>
      request(app)
        .post("/api/order/place-order")
        .set("Cookie", customer.cookie)
        .send({ paymentMethod: "cod", deliveryAddress, cartItems: [{ id: String(items[0]?._id), quantity: 1 }] });

    const ok = await order(address);
    expect(ok.status).toBe(201);
    const stored = await Order.findById(ok.body._id).lean();
    expect(stored?.deliveryAddress).toMatchObject({
      text: address.text,
      latitude: address.latitude,
      longitude: address.longitude,
      location: { type: "Point", coordinates: [address.longitude, address.latitude] },
    });

    expect((await order({ ...address, latitude: 120 })).status).toBe(400);
    expect((await order({ ...address, longitude: -181 })).status).toBe(400);
    expect((await order({ text: "x" })).status).toBe(400);
  });

  it("still reads orders that predate the GeoJSON field", async () => {
    const customer = await createUserWithRole("user");
    await mongoose.connection.collection("orders").insertOne({
      user: new mongoose.Types.ObjectId(customer.user._id),
      paymentMethod: "cod",
      deliveryAddress: { text: "legacy", latitude: 1, longitude: 2 },
      totalAmount: 1,
      shopOrders: [],
    });
    const res = await request(app).get("/api/order/my-orders").set("Cookie", customer.cookie);
    expect(res.status).toBe(200);
    expect(res.body[0].deliveryAddress).toMatchObject({ latitude: 1, longitude: 2 });
  });
});

describe("missing Geoapify configuration", () => {
  it("answers 503 GEOAPIFY_NOT_CONFIGURED without calling Geoapify", async () => {
    const saved = process.env.GEOAPIFY_API_KEY;
    process.env.GEOAPIFY_API_KEY = "";
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { reverseGeocode } = await import("../src/services/geo.service.js");
      await expect(reverseGeocode(23.2570, 77.4724)).rejects.toMatchObject({ status: 503, code: "GEOAPIFY_NOT_CONFIGURED" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.GEOAPIFY_API_KEY = saved;
      vi.resetModules();
    }
  });
});
