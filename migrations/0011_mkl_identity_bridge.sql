CREATE TABLE `external_identity_link` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`profile_email` text,
	`profile_name` text,
	`link_method` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_authenticated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `external_identity_link_issuer_subject_unique` UNIQUE(`issuer`,`subject`),
	CONSTRAINT `external_identity_link_provider_user_unique` UNIQUE(`provider`,`user_id`)
);
--> statement-breakpoint
CREATE INDEX `external_identity_link_user_idx` ON `external_identity_link` (`user_id`);
--> statement-breakpoint
CREATE TRIGGER `external_identity_link_reject_admin_insert`
BEFORE INSERT ON `external_identity_link`
WHEN EXISTS (
	SELECT 1 FROM `user` u
	WHERE u.`id` = NEW.`user_id`
		AND (',' || COALESCE(u.`role`, '') || ',') LIKE '%,admin,%'
)
BEGIN
	SELECT RAISE(ABORT, 'MKL_ADMIN_LINK_FORBIDDEN');
END;
--> statement-breakpoint
CREATE TRIGGER `external_identity_link_reject_admin_promotion`
BEFORE UPDATE OF `role` ON `user`
WHEN (',' || COALESCE(NEW.`role`, '') || ',') LIKE '%,admin,%'
	AND EXISTS (SELECT 1 FROM `external_identity_link` l WHERE l.`user_id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'MKL_LINKED_ADMIN_FORBIDDEN');
END;
--> statement-breakpoint
CREATE TRIGGER `external_identity_link_reject_user_delete`
BEFORE DELETE ON `user`
WHEN EXISTS (SELECT 1 FROM `external_identity_link` l WHERE l.`user_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'MKL_LINKED_ACCOUNT_DELETE_FORBIDDEN');
END;
