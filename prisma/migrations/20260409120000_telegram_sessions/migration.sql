-- Add telegramId to User
ALTER TABLE "User" ADD COLUMN "telegramId" TEXT;
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- Add channel and externalChatId to ChatSession
ALTER TABLE "ChatSession" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'web';
ALTER TABLE "ChatSession" ADD COLUMN "externalChatId" TEXT;
CREATE INDEX "ChatSession_userId_channel_externalChatId_idx" ON "ChatSession"("userId", "channel", "externalChatId");
