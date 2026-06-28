-- CreateTable
CREATE TABLE "storm_swaths" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'mrms_mesh',
    "eventDate" TIMESTAMP(3) NOT NULL,
    "hailMinIn" DOUBLE PRECISION NOT NULL,
    "rings" JSONB NOT NULL,
    "bboxMinLat" DOUBLE PRECISION NOT NULL,
    "bboxMinLng" DOUBLE PRECISION NOT NULL,
    "bboxMaxLat" DOUBLE PRECISION NOT NULL,
    "bboxMaxLng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storm_swaths_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storm_swaths_eventDate_idx" ON "storm_swaths"("eventDate");

-- CreateIndex
CREATE INDEX "storm_swaths_bboxMinLat_bboxMaxLat_idx" ON "storm_swaths"("bboxMinLat", "bboxMaxLat");
