import { createCallerFactory } from "../init";
import { appRouter } from "../router";
import type { DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient, User } from "$lib/generated/prisma/client";
import { Role, UserStatus, DecisionStatus } from "$lib/generated/prisma/client";

const factory = createCallerFactory(appRouter);

export function createTestCaller(
  prisma: DeepMockProxy<PrismaClient>,
  user: User | null = null,
) {
  return factory({ prisma: prisma as unknown as PrismaClient, user });
}

export const adminUser: User = {
  uid: "admin-uid",
  name: "Admin User",
  email: "admin@example.com",
  university: null,
  year: null,
  roles: [Role.ADMIN],
  status: UserStatus.CREATED,
  pendingDecision: null,
  activeDecision: null,
  teamId: null,
  groupId: null,
  createdAt: new Date("2024-01-01"),
  claimedBy: null,
  claimedAt: null,
};

/** A second admin, for exercising review-lock contention between two reviewers. */
export const adminUser2: User = {
  ...adminUser,
  uid: "admin2-uid",
  name: "Second Admin",
  email: "admin2@example.com",
};

export const organizerUser: User = {
  uid: "organizer-uid",
  name: "Organizer User",
  email: "organizer@example.com",
  university: null,
  year: null,
  roles: [Role.ORGANIZER],
  status: UserStatus.CREATED,
  pendingDecision: null,
  activeDecision: null,
  teamId: null,
  groupId: null,
  createdAt: new Date("2024-01-01"),
  claimedBy: null,
  claimedAt: null,
};

export const hackerUser: User = {
  uid: "hacker-uid",
  name: "Hacker User",
  email: "hacker@example.com",
  university: "University of Texas at Austin",
  year: "Junior",
  roles: [Role.HACKER],
  status: UserStatus.CREATED,
  pendingDecision: null,
  activeDecision: null,
  teamId: null,
  groupId: null,
  createdAt: new Date("2024-01-01"),
  claimedBy: null,
  claimedAt: null,
};

/** An applicant currently locked by `adminUser2`. Override claimedAt per test. */
export const claimedHacker: User = {
  ...hackerUser,
  uid: "claimed-uid",
  email: "claimed@example.com",
  claimedBy: adminUser2.uid,
  claimedAt: new Date("2024-01-01"),
};

export const appliedHacker: User = {
  ...hackerUser,
  uid: "applied-uid",
  email: "applied@example.com",
  status: UserStatus.APPLIED,
};

export const acceptedHacker: User = {
  ...hackerUser,
  uid: "accepted-uid",
  email: "accepted@example.com",
  status: UserStatus.APPLIED,
  activeDecision: DecisionStatus.ACCEPTED,
};

export const confirmedHacker: User = {
  ...hackerUser,
  uid: "confirmed-uid",
  email: "confirmed@example.com",
  status: UserStatus.CONFIRMED,
  activeDecision: DecisionStatus.ACCEPTED,
};

export const waitlistedHacker: User = {
  ...hackerUser,
  uid: "waitlisted-uid",
  email: "waitlisted@example.com",
  status: UserStatus.APPLIED,
  activeDecision: DecisionStatus.WAITLISTED,
};

export const mockSettings = {
  id: "settings-1",
  applicationOpen: new Date("2024-01-01"),
  applicationDeadline: new Date("2024-03-01"),
  RSVPDeadline: new Date("2024-04-01"),
  admissionsSend: null,
  hackathonStartDate: new Date("2024-04-15"),
  scanActions: ["Check-In"],
  submitTemplate: "Hi {{name}}, submitted!",
  acceptTemplate: "Hi {{name}}, accepted!",
  confirmTemplate: "Hi {{name}}, confirmed!",
  declineTemplate: "Hi {{name}}, declined.",
  rejectTemplate: "Hi {{name}}, rejected.",
  waitlistTemplate: "Hi {{name}}, waitlisted.",
  timezone: "America/Chicago",
};
