CREATE TABLE `behavior_patterns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`patternType` varchar(100) NOT NULL,
	`description` text NOT NULL,
	`confidence` float NOT NULL DEFAULT 0.7,
	`frequency` int NOT NULL DEFAULT 1,
	`lastObserved` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `behavior_patterns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('fact','behavior','preference','emotion') NOT NULL,
	`content` text NOT NULL,
	`importance` float NOT NULL DEFAULT 0.5,
	`confidence` float NOT NULL DEFAULT 0.8,
	`accessCount` int NOT NULL DEFAULT 0,
	`clusterId` int,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastAccessedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memory_clusters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`summary` text NOT NULL,
	`memberCount` int NOT NULL DEFAULT 0,
	`avgImportance` float NOT NULL DEFAULT 0.5,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memory_clusters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`personality` varchar(50) NOT NULL DEFAULT 'professional',
	`responseStyle` varchar(50) NOT NULL DEFAULT 'balanced',
	`proactiveService` enum('enabled','disabled') NOT NULL DEFAULT 'enabled',
	`notificationPreference` json DEFAULT ('{"taskReminders":true,"behaviorInsights":true,"dailySummary":false}'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_preferences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `behavior_patterns` ADD CONSTRAINT `behavior_patterns_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memories` ADD CONSTRAINT `memories_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memory_clusters` ADD CONSTRAINT `memory_clusters_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD CONSTRAINT `user_preferences_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `behavior_patterns` (`userId`);--> statement-breakpoint
CREATE INDEX `pattern_type_idx` ON `behavior_patterns` (`patternType`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `conversations` (`userId`);--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `conversations` (`createdAt`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `memories` (`userId`);--> statement-breakpoint
CREATE INDEX `type_idx` ON `memories` (`type`);--> statement-breakpoint
CREATE INDEX `importance_idx` ON `memories` (`importance`);--> statement-breakpoint
CREATE INDEX `last_accessed_idx` ON `memories` (`lastAccessedAt`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `memory_clusters` (`userId`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `user_preferences` (`userId`);