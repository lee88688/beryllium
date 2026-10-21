CREATE TABLE `Book` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`description` text NOT NULL,
	`cover` text NOT NULL,
	`fileName` text NOT NULL,
	`contentPath` text NOT NULL,
	`current` text NOT NULL,
	`content` text NOT NULL,
	`userId` integer NOT NULL,
	CONSTRAINT `fk_Book_userId_User_id_fk` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `Category` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`userId` integer NOT NULL,
	CONSTRAINT `fk_Category_userId_User_id_fk` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `CategoryBook` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`bookId` integer NOT NULL,
	`categoryId` integer NOT NULL,
	CONSTRAINT `fk_CategoryBook_bookId_Book_id_fk` FOREIGN KEY (`bookId`) REFERENCES `Book`(`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT `fk_CategoryBook_categoryId_Category_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `Mark` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`type` text NOT NULL,
	`epubcfi` text NOT NULL,
	`color` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`selectedString` text NOT NULL,
	`bookId` integer NOT NULL,
	`userId` integer NOT NULL,
	CONSTRAINT `fk_Mark_bookId_Book_id_fk` FOREIGN KEY (`bookId`) REFERENCES `Book`(`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT `fk_Mark_userId_User_id_fk` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `User` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`isAdmin` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `CategoryBook_bookId_categoryId_key` ON `CategoryBook` (`bookId`,`categoryId`);--> statement-breakpoint
CREATE UNIQUE INDEX `User_username_key` ON `User` (`username`);