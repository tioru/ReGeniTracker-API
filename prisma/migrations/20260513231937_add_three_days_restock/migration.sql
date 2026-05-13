/*
  Warnings:

  - The values [WEEKLY,MONTHLY] on the enum `RestockType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "RestockType_new" AS ENUM ('NEVER', 'THREE_DAYS');
ALTER TABLE "MaterialSeller" ALTER COLUMN "restock" TYPE "RestockType_new" USING ("restock"::text::"RestockType_new");
ALTER TYPE "RestockType" RENAME TO "RestockType_old";
ALTER TYPE "RestockType_new" RENAME TO "RestockType";
DROP TYPE "public"."RestockType_old";
COMMIT;
