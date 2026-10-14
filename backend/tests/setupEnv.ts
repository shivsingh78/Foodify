// Runs before any test module is imported, so config/env.ts sees these values.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";
process.env.MONGODB_URL = process.env.TEST_MONGO_URI ?? "mongodb://127.0.0.1:27017/foodify-test";
process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "razorpay-test-secret";
process.env.GEOAPIFY_API_KEY = "test-geoapify-key";
process.env.VITE_GEOAPIFY_MAPS_API_KEY = "test-browser-map-key";
process.env.FRONTEND_URL = "http://localhost:5173";
// dotenv never overrides existing variables, so blank values keep tests hermetic
// even when a developer has a real backend/.env.
for (const key of [
  "REDIS_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
]) {
  process.env[key] = "";
}
