-- Rename the "water" industry workspace to "others" (a catch-all). RENAME VALUE
-- is non-destructive: all existing rows/arrays/defaults referencing water are
-- updated in place automatically.
ALTER TYPE "Industry" RENAME VALUE 'water' TO 'others';
