-- Chat sessions table
CREATE TABLE IF NOT EXISTS `chat_sessions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `title` varchar(200) DEFAULT '新会话' NOT NULL,
  `createdAt` timestamp DEFAULT (now()) NOT NULL,
  `updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `chat_sessions_id` PRIMARY KEY(`id`)
);

-- Add sessionId to conversations
ALTER TABLE `conversations` ADD COLUMN `sessionId` int;
ALTER TABLE `conversations` ADD INDEX `session_id_idx` (`sessionId`);
