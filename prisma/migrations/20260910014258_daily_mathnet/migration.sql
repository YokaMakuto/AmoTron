-- CreateTable
CREATE TABLE "DailyProblem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "problemMarkdown" TEXT NOT NULL,
    "solutionMarkdown" TEXT NOT NULL,
    "topics" TEXT NOT NULL DEFAULT '[]',
    "competition" TEXT NOT NULL DEFAULT 'Unknown',
    "country" TEXT NOT NULL DEFAULT 'Unknown',
    "hardness" TEXT NOT NULL DEFAULT 'Medium',
    "hardnessReason" TEXT,
    "problemType" TEXT,
    "finalAnswer" TEXT,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DailyPost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "problemMessageId" TEXT,
    "solutionMessageId" TEXT,
    "postedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "solutionDueAt" DATETIME NOT NULL,
    "solved" BOOLEAN NOT NULL DEFAULT false
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GuildConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "privateCategoryId" TEXT,
    "logChannelId" TEXT,
    "removalAction" TEXT NOT NULL DEFAULT 'KEEP_CHANNEL',
    "dailyChannelId" TEXT,
    "dailyTimeUtc" TEXT NOT NULL DEFAULT '07:00',
    "dailyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyCursor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GuildConfig" ("createdAt", "guildId", "id", "logChannelId", "privateCategoryId", "removalAction", "updatedAt") SELECT "createdAt", "guildId", "id", "logChannelId", "privateCategoryId", "removalAction", "updatedAt" FROM "GuildConfig";
DROP TABLE "GuildConfig";
ALTER TABLE "new_GuildConfig" RENAME TO "GuildConfig";
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DailyPost_guildId_postedAt_idx" ON "DailyPost"("guildId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPost_guildId_problemId_key" ON "DailyPost"("guildId", "problemId");
