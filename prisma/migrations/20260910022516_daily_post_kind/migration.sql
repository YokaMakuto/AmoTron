-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DailyPost" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "problemMessageId" TEXT,
    "solutionMessageId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'scheduled',
    "postedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "solutionDueAt" DATETIME NOT NULL,
    "solved" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_DailyPost" ("guildId", "id", "postedAt", "problemId", "problemMessageId", "solutionDueAt", "solutionMessageId", "solved") SELECT "guildId", "id", "postedAt", "problemId", "problemMessageId", "solutionDueAt", "solutionMessageId", "solved" FROM "DailyPost";
DROP TABLE "DailyPost";
ALTER TABLE "new_DailyPost" RENAME TO "DailyPost";
CREATE INDEX "DailyPost_guildId_postedAt_idx" ON "DailyPost"("guildId", "postedAt");
CREATE UNIQUE INDEX "DailyPost_guildId_problemId_key" ON "DailyPost"("guildId", "problemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
