-- Add canvasser + marketing roles (additive; retired roles kept for existing data).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'canvasser';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'marketing';
