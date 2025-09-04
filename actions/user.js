"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { generateAIInsights } from "./dashboard";

// Update user profile + industry insights
export async function updateUser(data) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // Ensure user exists or create them
  let user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) {
    // Fetch user details from Clerk
    const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    });
    const clerkUser = await response.json();

    user = await db.user.create({
      data: {
        clerkUserId: userId,
        email: clerkUser.email_addresses?.[0]?.email_address || "",
        name: clerkUser.first_name || "",
        imageUrl: clerkUser.image_url || null,
      },
    });
  }

  try {
    // Transaction for industry + user update
    const result = await db.$transaction(
      async (tx) => {
        // Check if industry insights already exist
        let industryInsight = await tx.industryInsight.findUnique({
          where: { industry: data.industry },
        });

        // If not, generate and insert AI insights
        if (!industryInsight) {
          const insights = await generateAIInsights(data.industry);

          industryInsight = await tx.industryInsight.create({
            data: {
              industry: data.industry,
              ...insights,
              nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
            },
          });
        }

        // Update user profile
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: {
            industry: data.industry,
            experience: data.experience,
            bio: data.bio,
            skills: data.skills,
          },
        });

        return { updatedUser, industryInsight };
      },
      { timeout: 10000 }
    );

    revalidatePath("/");
    return result.updatedUser;
  } catch (error) {
    console.error("Error updating user and industry:", error.message);
    throw new Error("Failed to update profile");
  }
}

// Check onboarding status (create user if missing)
export async function getUserOnboardingStatus() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  let user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  // Auto-create user if not found
  if (!user) {
    const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    });
    const clerkUser = await response.json();

    user = await db.user.create({
      data: {
        clerkUserId: userId,
        email: clerkUser.email_addresses?.[0]?.email_address || "",
        name: clerkUser.first_name || "",
        imageUrl: clerkUser.image_url || null,
      },
    });
  }

  return {
    isOnboarded: !!user.industry,
  };
}
