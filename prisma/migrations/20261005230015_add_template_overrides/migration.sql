-- CreateTable
CREATE TABLE "TemplateOverride" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "TemplateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateOverride_templateKey_role_key" ON "TemplateOverride"("templateKey", "role");
