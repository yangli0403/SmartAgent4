-- 仅补充 memories 表缺失的列（chat_sessions 等已存在）
ALTER TABLE `memories` ADD COLUMN `kind` enum('episodic','semantic','persona') DEFAULT 'semantic' NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD COLUMN `tags` json;--> statement-breakpoint
ALTER TABLE `memories` ADD COLUMN `source` varchar(64);--> statement-breakpoint
ALTER TABLE `memories` ADD COLUMN `versionGroup` varchar(100);--> statement-breakpoint
CREATE INDEX `kind_idx` ON `memories` (`kind`);--> statement-breakpoint
CREATE INDEX `version_group_idx` ON `memories` (`versionGroup`);
