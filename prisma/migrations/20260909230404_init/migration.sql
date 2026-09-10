-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "discordUserId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "usernameSnapshot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PrivateRoom" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "categoryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "privateCategoryId" TEXT,
    "logChannelId" TEXT,
    "removalAction" TEXT NOT NULL DEFAULT 'KEEP_CHANNEL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TriggerRole" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StaffRole" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "targetUserId" TEXT,
    "channelId" TEXT,
    "roleId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_guildId_discordUserId_key" ON "User"("guildId", "discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateRoom_channelId_key" ON "PrivateRoom"("channelId");

-- CreateIndex
CREATE INDEX "PrivateRoom_guildId_discordUserId_idx" ON "PrivateRoom"("guildId", "discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateRoom_guildId_discordUserId_status_key" ON "PrivateRoom"("guildId", "discordUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "TriggerRole_guildId_roleId_key" ON "TriggerRole"("guildId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRole_guildId_roleId_key" ON "StaffRole"("guildId", "roleId");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");
