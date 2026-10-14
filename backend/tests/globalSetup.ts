import { MongoMemoryServer } from "mongodb-memory-server";

/** One in-memory MongoDB for the whole run; each test file uses its own database. */
export default async function setup() {
  const mongod = await MongoMemoryServer.create();
  process.env.TEST_MONGO_URI = mongod.getUri();
  return async () => {
    await mongod.stop({ doCleanup: true, force: true });
  };
}
