import User from "../models/user.model.js";
import { AppError } from "../utils/AppError.js";

export const getUserById = async (userId: string) => {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound("User not found");
  return user;
};

export const updateUserLocation = async (userId: string, lat: number, lon: number) => {
  const result = await User.updateOne(
    { _id: userId },
    { location: { type: "Point", coordinates: [lon, lat] }, locationUpdatedAt: new Date() },
  );
  if (result.matchedCount !== 1) throw AppError.notFound("User not found");
};
