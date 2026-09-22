-- New performer registration lives alongside the legacy DriverProfile flow.
CREATE TYPE "RegistrationApplicationStatus" AS ENUM ('NOT_STARTED', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED', 'REJECTED', 'BLOCKED');
CREATE TYPE "PerformerRole" AS ENUM ('TAXI_DRIVER', 'CARGO_DRIVER', 'COURIER');
CREATE TYPE "RegistrationDocumentStatus" AS ENUM ('NOT_UPLOADED', 'DRAFT', 'UPLOADED', 'UNDER_REVIEW', 'APPROVED', 'CORRECTION_REQUIRED', 'REJECTED', 'BLOCKED', 'ACTIVE', 'EXPIRING', 'EXPIRED');
CREATE TYPE "RegistrationUploadKind" AS ENUM ('PROFILE_PHOTO', 'IDENTITY_DOCUMENT', 'DRIVER_LICENSE', 'VEHICLE_DOCUMENT', 'VEHICLE_PHOTO', 'ADDITIONAL_DOCUMENT');

CREATE TABLE "PerformerApplication" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "status" "RegistrationApplicationStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "currentStep" TEXT NOT NULL DEFAULT 'ROLES',
  "data" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "canResubmit" BOOLEAN NOT NULL DEFAULT false,
  "legalTermsVersion" TEXT,
  "acceptedConsentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "truthConfirmedAt" TIMESTAMP(3),
  "termsAcceptedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PerformerApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PerformerApplicationRole" (
  "id" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "role" "PerformerRole" NOT NULL,
  "selected" BOOLEAN NOT NULL DEFAULT true,
  "status" "RegistrationApplicationStatus" NOT NULL DEFAULT 'DRAFT',
  "canResubmit" BOOLEAN NOT NULL DEFAULT false,
  "correctionFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "projectedAt" TIMESTAMP(3),
  "projectionIssueCode" TEXT,
  "reasonCode" TEXT,
  "reasonText" TEXT,
  "blockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PerformerApplicationRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PerformerUpload" (
  "id" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "slotKey" TEXT NOT NULL,
  "kind" "RegistrationUploadKind" NOT NULL,
  "role" "PerformerRole",
  "status" "RegistrationDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3),
  "reasonCode" TEXT,
  "reasonText" TEXT,
  "canReupload" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PerformerUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerformerApplication_userId_key" ON "PerformerApplication"("userId");
CREATE INDEX "PerformerApplication_status_updatedAt_idx" ON "PerformerApplication"("status", "updatedAt");
CREATE UNIQUE INDEX "PerformerApplicationRole_applicationId_role_key" ON "PerformerApplicationRole"("applicationId", "role");
CREATE INDEX "PerformerApplicationRole_applicationId_selected_idx" ON "PerformerApplicationRole"("applicationId", "selected");
CREATE INDEX "PerformerApplicationRole_role_status_idx" ON "PerformerApplicationRole"("role", "status");
CREATE UNIQUE INDEX "PerformerUpload_applicationId_slotKey_key" ON "PerformerUpload"("applicationId", "slotKey");
CREATE INDEX "PerformerUpload_applicationId_status_idx" ON "PerformerUpload"("applicationId", "status");
CREATE INDEX "PerformerUpload_expiresAt_idx" ON "PerformerUpload"("expiresAt");

ALTER TABLE "PerformerApplication" ADD CONSTRAINT "PerformerApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PerformerApplicationRole" ADD CONSTRAINT "PerformerApplicationRole_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PerformerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PerformerUpload" ADD CONSTRAINT "PerformerUpload_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PerformerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriverProfile" ADD COLUMN "courierModes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "DriverProfile" ADD COLUMN "registrationManaged" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PushJob" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "PushJob" ADD COLUMN "payload" JSONB;
