import { PrismaClient, UserRole } from "@prisma/client";

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
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
