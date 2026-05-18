import { PrismaClient, UserRole } from "@prisma/client";
import { ensureOpsDefaults } from "../src/lib/ops/defaults";

const prisma = new PrismaClient();

const FIRST_ADMIN_EMAIL = "feroz@automatedengineering.io";

async function main() {
  await prisma.user.upsert({
    where: { email: FIRST_ADMIN_EMAIL },
    create: {
      email: FIRST_ADMIN_EMAIL,
      name: "Feroz",
      role: UserRole.ADMIN,
      isActive: true,
    },
    update: {
      role: UserRole.ADMIN,
      tenantId: null,
      isActive: true,
    },
  });

  console.log(`Seeded admin user: ${FIRST_ADMIN_EMAIL}`);

  const demoA = await prisma.tenant.upsert({
    where: { slug: "demo-georgia-brokerage" },
    create: {
      name: "Demo Georgia Brokerage",
      slug: "demo-georgia-brokerage",
      brokerageName: "Demo Georgia Brokerage",
      flyerNotifyEmail: "ops@example.com",
      brokerPhone: "(404) 555-0199",
    },
    update: {},
  });

  const demoB = await prisma.tenant.upsert({
    where: { slug: "demo-atlanta-team" },
    create: {
      name: "Demo Atlanta Team",
      slug: "demo-atlanta-team",
      brokerageName: "Demo Atlanta Team",
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { email: "owner@example.com" },
    create: {
      email: "owner@example.com",
      name: "Demo Owner",
      role: UserRole.BROKER_OWNER,
      tenantId: demoA.id,
      isActive: true,
    },
    update: { tenantId: demoA.id, role: UserRole.BROKER_OWNER, isActive: true },
  });

  await prisma.user.upsert({
    where: { email: "agent@example.com" },
    create: {
      email: "agent@example.com",
      name: "Demo Agent",
      role: UserRole.AGENT,
      tenantId: demoA.id,
      isActive: true,
    },
    update: { tenantId: demoA.id, role: UserRole.AGENT, isActive: true },
  });

  await prisma.user.upsert({
    where: { email: "owner2@example.com" },
    create: {
      email: "owner2@example.com",
      name: "Second Demo Owner",
      role: UserRole.BROKER_OWNER,
      tenantId: demoB.id,
      isActive: true,
    },
    update: { tenantId: demoB.id, role: UserRole.BROKER_OWNER, isActive: true },
  });

  await ensureOpsDefaults(prisma, demoA.id);
  await ensureOpsDefaults(prisma, demoB.id);

  console.log("Seeded demo brokerages and operations defaults.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
