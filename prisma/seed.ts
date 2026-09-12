import { PrismaClient } from "@prisma/client";

// Seeds the database with the role/category IDs that were previously
// hard-coded in index.js, so the refactor preserves existing behaviour.
// Guild ID is taken from GUILD_ID env when available; otherwise a placeholder
// the admin replaces via /setup and /config commands.
const prisma = new PrismaClient();

// IDs migrated from the legacy index.js (preserved verbatim).
const LEGACY_TRIGGER_ROLES = [
  "1541005855250710538",
  "1541005855229485156",
  "1547340789917425664",
  "1541005855229485153",
];

const LEGACY_STAFF_ROLES = [
  "1541005855263162430",
  "1541005855263162429",
  "1541005855250710547",
  "1541005855263162432",
  "1541098213665280021",
];

const LEGACY_CATEGORY_ID = "1541005858564218944";

async function main(): Promise<void> {
  const guildId = process.env["GUILD_ID"] ?? "REPLACE_WITH_GUILD_ID";

  await prisma.guildConfig.upsert({
    where: { guildId },
    update: { privateCategoryId: LEGACY_CATEGORY_ID },
    create: { guildId, privateCategoryId: LEGACY_CATEGORY_ID },
  });

  for (const roleId of LEGACY_TRIGGER_ROLES) {
    await prisma.triggerRole.upsert({
      where: { guildId_roleId: { guildId, roleId } },
      update: {},
      create: { guildId, roleId },
    });
  }

  for (const roleId of LEGACY_STAFF_ROLES) {
    await prisma.staffRole.upsert({
      where: { guildId_roleId: { guildId, roleId } },
      update: {},
      create: { guildId, roleId },
    });
  }

  console.log(`[SEED] Seeded config for guild ${guildId}`);
}

main()
  .catch((err) => {
    console.error("[SEED] Failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
